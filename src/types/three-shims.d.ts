declare module 'three' {
  const THREE: any
  export = THREE
}

declare module 'three/examples/jsm/controls/OrbitControls.js' {
  import type { Camera, EventDispatcher, Vector3 } from 'three'

  export class OrbitControls extends EventDispatcher {
    constructor(camera: Camera, domElement?: HTMLElement)
    enableDamping: boolean
    target: Vector3
    update(): void
    dispose(): void
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { LoadingManager, Object3D } from 'three'

  export type GLTF = {
    scene: Object3D
  }

  export class GLTFLoader {
    constructor(manager?: LoadingManager)
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void,
    ): void
    parse(
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError?: (error: unknown) => void,
    ): void
  }
}
