// quagga ships no type declarations. A bodied ambient module wins over the
// implicit-any JS resolution that `checkJs` would otherwise flag.
declare module 'quagga' {
	const Quagga: any;
	export default Quagga;
}
