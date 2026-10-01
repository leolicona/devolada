/* cash-at-stores D32: the window's width, which `useWide()` and the
   frame's media query read. happy-dom answers `matchMedia` from it and
   fires the change. Its own module, importing nothing of the app: the
   setup file loads it before each test file's `vi.mock` is registered,
   and an app module loaded here would keep its real dependencies. */
export function atWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({
    width,
    height: width < 500 ? 812 : 900,
  });
}
