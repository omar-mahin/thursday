export type Viewport = {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
  documentWidth: number;
  documentHeight: number;
};

/** Viewport-relative unless a field name says otherwise. */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
