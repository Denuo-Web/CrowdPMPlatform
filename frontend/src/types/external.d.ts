/// <reference types="google.maps" />

declare module "three" {
  class Object3D {
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
  }

  export class Scene extends Object3D {}

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
  }

  export class BufferAttribute {
    needsUpdate: boolean;
    constructor(array: ArrayLike<number>, itemSize: number);
    setXYZ(index: number, x: number, y: number, z: number): void;
  }

  export class BufferGeometry {
    setAttribute(name: string, attribute: BufferAttribute): this;
    setDrawRange(start: number, count: number): void;
    dispose(): void;
    computeBoundingSphere(): void;
  }

  class Material {
    dispose(): void;
  }

  export class LineBasicMaterial extends Material {
    constructor(parameters?: { vertexColors?: boolean });
  }

  export class Line<
    TGeometry extends BufferGeometry = BufferGeometry,
    TMaterial extends Material = Material
  > extends Object3D {
    geometry: TGeometry;
    material: TMaterial | TMaterial[];
    constructor(geometry?: TGeometry, material?: TMaterial);
  }
}

declare module "@googlemaps/three" {
  import type { Scene, Vector3 } from "three";

  export interface ThreeJSOverlayViewOptions {
    map?: google.maps.Map | null;
    anchor?: google.maps.LatLngAltitudeLiteral;
    addDefaultLighting?: boolean;
  }

  export class ThreeJSOverlayView implements google.maps.WebGLOverlayView {
    readonly scene: Scene;
    constructor(options?: ThreeJSOverlayViewOptions);
    requestRedraw(): void;
    setAnchor(anchor: google.maps.LatLngAltitudeLiteral): void;
    latLngAltitudeToVector3(
      position: google.maps.LatLngAltitudeLiteral,
      target?: Vector3
    ): Vector3;
    onBeforeDraw(): void;
    onRemove(): void;
    setMap(map: google.maps.Map | null): void;
  }
}
