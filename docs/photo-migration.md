# Photos: getting them into the external inventory database

There are two ways to do this, and they solve different problems.

|                                 | **A — link** (current)               | **B — copy the files**    |
| ------------------------------- | ------------------------------------ | ------------------------- |
| What lands in the DB            | Convex URLs in a `photo_urls` column | real files + `media` rows |
| Needs                           | one migration (below)                | droplet/app access        |
| Convex dependency               | permanent                            | none after the run        |
| Laravel image tooling           | unavailable                          | conversions, thumbnails   |
| If a photo is edited in the app | link breaks                          | unaffected                |

**A is what the export currently produces.** B is documented further down as the
path to a self-contained database, whenever that's wanted. They aren't exclusive
— A now, B later, is a reasonable sequence.

---

# A — the `photo_urls` column

## The migration

This is the only schema change anything here requires. Hand it to whoever owns
the database:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            // Nullable: items without photos, and rows this import never touches,
            // must stay valid. JSON because an item can have several photos.
            $table->json('photo_urls')->nullable()->after('barcode');
        });
    }

    public function down(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->dropColumn('photo_urls');
        });
    }
};
```

Or as plain DDL, if they'd rather not run a migration:

```sql
ALTER TABLE `items` ADD COLUMN `photo_urls` json DEFAULT NULL AFTER `barcode`;
```

> **Naming.** You asked for `photos_url`; the export writes **`photo_urls`**,
> since the column holds several. To switch it back, change
> `PHOTO_URLS_COLUMN` in [`src/lib/services/sql-export.ts`](../src/lib/services/sql-export.ts)
> and the migration to match. It's one word in one place.

## What the export writes

A JSON array, or `NULL` for items with no photos:

```sql
INSERT INTO `items` (…, `photo_urls`) VALUES
  ('KIT10000001', …, '["https://xyz.convex.cloud/api/storage/abc","https://…/def"]'),
  ('RIG10000002', …, NULL)
ON DUPLICATE KEY UPDATE …, `photo_urls` = VALUES(`photo_urls`);
```

MySQL parses the literal into JSON on insert, so a malformed array is rejected
rather than stored as garbage.

## Two things to know

- **The links are only as durable as the Convex files.** Your app deletes a
  storage file when a photo drops off an item
  ([`convex/items.ts`](../convex/items.ts)), so editing a photo afterwards breaks
  the stored link. Nothing on the database side will notice.
- **An export with no photo links omits the column entirely.** Offline, or when
  the Convex pull fails, the statement simply doesn't mention `photo_urls`, so
  importing it leaves whatever links are stored untouched. There's no way to
  produce a file that silently blanks them.
- **When links _are_ included, the column is authoritative.** An item with no
  photos writes `NULL` — which is what correctly clears the links after its
  photos were deleted in the app.

---

# B — copy the files into MediaLibrary

The rest of this document covers making the database self-contained: real files
on a storage disk, indexed by `media`, with no dependency on Convex.

MediaLibrary derives the file path from the row's own `id`/`uuid` and writes
`custom_properties` / `generated_conversions` / responsive images — so
hand-writing `media` INSERTs and rsyncing files is the fragile way to do this.
Instead the photos move in a second pass, driven by MediaLibrary itself.

## The two files

| File                     | From                    | Contains                    |
| ------------------------ | ----------------------- | --------------------------- |
| `inventory_import_*.sql` | `Export SQL`            | `categories` + `items` rows |
| `photo_manifest_*.json`  | `Export Photo Manifest` | `sku` → Convex photo URLs   |

The manifest is built from a **live Convex query**, so it needs a connection and
returns freshly-resolved URLs rather than the app's local display cache.

```json
{
	"generated_at": "2026-07-28T09:00:00.000Z",
	"item_count": 2,
	"photo_count": 3,
	"items": [
		{ "sku": "KIT10000001", "name": "Chef's Knife", "photos": ["https://….convex.cloud/…"] }
	],
	"warnings": [
		{
			"sku": "OLD123",
			"reason": "1 of 2 photo(s) could not be resolved by Convex (legacy base64 or missing storage file)"
		}
	]
}
```

**Read `warnings` before running.** Two cases show up there:

- _Legacy base64_ — items synced before File Storage landed keep raw base64 in
  `photos` instead of a storage id, and Convex can't resolve them
  ([`convex/items.ts`](../convex/items.ts) documents this). The bytes still exist
  inside the Convex document; extracting them needs a separate one-off script.
- _Missing storage file_ — the id points at a file that's gone. Not recoverable.

Photos on items that have **never synced** are not in Convex at all — they live
only in that device's IndexedDB as `data:` URLs. Sync every device that has been
used offline _before_ exporting; the manifest export warns if anything is pending.

## Order of operations

1. Sync all devices, so Convex holds everything.
2. `Export SQL` → import it, so `items` rows exist with their SKUs.
3. `Export Photo Manifest`.
4. Run the command below, which matches manifest entries to items by SKU.

Steps 2 and 4 are both re-runnable.

## Prerequisite: is `Item` media-enabled?

The command needs the `Item` model to implement MediaLibrary's contract. Check
`app/Models/Item.php` on the droplet for:

```php
class Item extends Model implements \Spatie\MediaLibrary\HasMedia
{
    use \Spatie\MediaLibrary\InteractsWithMedia;
}
```

If it isn't there, add it (and register a `photos` collection) before running —
otherwise `addMediaFromUrl()` won't exist on the model.

## The command

Save as `app/Console/Commands/ImportInventoryPhotos.php` in the Laravel app:

```php
<?php

namespace App\Console\Commands;

use App\Models\Item;
use Illuminate\Console\Command;

class ImportInventoryPhotos extends Command
{
    protected $signature = 'inventory:import-photos
                            {manifest : Path to photo_manifest_*.json}
                            {--collection=photos : MediaLibrary collection name}
                            {--dry-run : Report what would happen, change nothing}';

    protected $description = 'Attach photos from a Convex export manifest to items, matched by SKU.';

    public function handle(): int
    {
        $path = $this->argument('manifest');
        if (! is_readable($path)) {
            $this->error("Cannot read manifest: {$path}");
            return self::FAILURE;
        }

        $manifest = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        $collection = $this->option('collection');
        $dryRun = $this->option('dry-run');

        foreach ($manifest['warnings'] ?? [] as $warning) {
            $this->warn("manifest: {$warning['sku']} — {$warning['reason']}");
        }

        $attached = $missing = $skipped = $failed = 0;

        foreach ($manifest['items'] ?? [] as $entry) {
            $item = Item::where('sku', $entry['sku'])->first();

            if (! $item) {
                $this->warn("no item with sku {$entry['sku']} — import the SQL export first");
                $missing++;
                continue;
            }

            foreach ($entry['photos'] as $index => $url) {
                // Idempotent: name each media row after the sku + position, so a
                // re-run recognises what it already attached instead of duplicating.
                $name = "{$entry['sku']}-{$index}";

                if ($item->getMedia($collection)->firstWhere('name', $name)) {
                    $skipped++;
                    continue;
                }

                if ($dryRun) {
                    $this->line("would attach {$name}");
                    $attached++;
                    continue;
                }

                try {
                    $item->addMediaFromUrl($url)
                        ->usingName($name)
                        ->usingFileName("{$name}.jpg")
                        ->toMediaCollection($collection);
                    $attached++;
                } catch (\Throwable $e) {
                    $this->error("{$name}: {$e->getMessage()}");
                    $failed++;
                }
            }
        }

        $this->newLine();
        $this->info(($dryRun ? '[dry run] ' : '')
            . "attached {$attached}, already present {$skipped}, failed {$failed}, items not found {$missing}");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
```

Run it:

```bash
# on the droplet, from the Laravel app root
php artisan inventory:import-photos storage/app/photo_manifest_2026-07-28.json --dry-run
php artisan inventory:import-photos storage/app/photo_manifest_2026-07-28.json
```

Notes:

- **Idempotent** via the `sku-index` media name — a second run attaches nothing
  and reports the photos as already present. Safe to re-run after a partial
  failure.
- `--dry-run` first. It resolves items and reports counts without writing.
- `.jpg` is assumed for the filename; the app compresses captures to JPEG
  ([`src/lib/services/image.ts`](../src/lib/services/image.ts)). If that ever
  changes, derive the extension from the response's `Content-Type` instead.
- The droplet fetches each URL directly from Convex, so it needs outbound
  network access. The URLs are unauthenticated — anyone holding one can fetch the
  image — so treat the manifest as sensitive and delete it when done.

## Disk space, and using DigitalOcean Spaces instead

### How much space is actually needed

The app compresses every photo to **1600px max, JPEG quality 0.75**
([`src/lib/services/image.ts`](../src/lib/services/image.ts)) — roughly 200–400 KB
each. Multiply the manifest's `photo_count` by ~0.3 MB for a working estimate:

| Photos | Approx. total |
| ------ | ------------- |
| 500    | ~150 MB       |
| 2,000  | ~600 MB       |
| 10,000 | ~3 GB         |

For scale: the smallest DigitalOcean droplet has 25 GB of SSD. Check `df -h`
before assuming space is the binding constraint — in most cases it isn't.

### If it is: point the media collection at Spaces

MediaLibrary writes to any Laravel filesystem disk, S3-compatible included. The
`media` table **already has `disk` and `conversions_disk` columns**, so this
needs no schema change — files simply never land on the droplet.

1. Install the S3 adapter, if it isn't already present:

   ```bash
   composer require league/flysystem-aws-s3-v3
   ```

2. Add the disk to `config/filesystems.php`:

   ```php
   'spaces' => [
       'driver' => 's3',
       'key' => env('DO_SPACES_KEY'),
       'secret' => env('DO_SPACES_SECRET'),
       'region' => env('DO_SPACES_REGION', 'nyc3'),
       'bucket' => env('DO_SPACES_BUCKET'),
       'endpoint' => env('DO_SPACES_ENDPOINT'), // https://nyc3.digitaloceanspaces.com
       'use_path_style_endpoint' => false,
       'visibility' => 'public',
       'throw' => false,
   ],
   ```

3. Point the collection at it, in `app/Models/Item.php`:

   ```php
   public function registerMediaCollections(): void
   {
       $this->addMediaCollection('photos')
           ->useDisk('spaces')
           ->storeConversionsOnDisk('spaces');
   }
   ```

The Artisan command above then works **unchanged** — `toMediaCollection()`
follows whatever disk the collection is configured for.

Two caveats:

- Changing the disk config affects **new** media only. Rows already written to
  the local disk stay there; MediaLibrary won't relocate them. For a first-time
  import that's moot, but don't expect it to migrate existing images.
- `visibility => 'public'` makes the objects world-readable by URL, which is what
  MediaLibrary's `getUrl()` assumes. If these photos shouldn't be public, use
  private visibility and temporary URLs instead — that's a decision for whoever
  owns the app, not something this import should quietly settle.

### What this does _not_ solve

Storing Convex URLs as links in the database remains impossible: `items` has no
column for a URL, `media` rows point at a disk and path rather than an external
address, and the schema can't be altered. Spaces changes _where the bytes live_,
not whether the bytes have to be copied at all.
