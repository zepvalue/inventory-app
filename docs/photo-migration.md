# Photo migration — Convex File Storage → Laravel (Spatie MediaLibrary)

The SQL export (`Export SQL` in the dashboard menu) carries the **item rows**. It
cannot carry image bytes: the target schema stores images through Spatie
MediaLibrary, which keeps files on a storage disk and indexes them in the `media`
table. MediaLibrary derives the file path from the row's own `id`/`uuid` and
writes `custom_properties` / `generated_conversions` / responsive images — so
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
