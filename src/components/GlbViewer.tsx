import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

type GlbViewerProps = {
  glb: Uint8Array | null
  glbUrl?: string | null
  isLoading: boolean
  emptyMessage?: string
}

type ViewerState = {
  renderer: any
  scene: any
  camera: any
  controls: OrbitControls
  loader: GLTFLoader
  animationId: number | null
  currentObject: any | null
}

function GlbViewer({ glb, glbUrl, isLoading, emptyMessage }: GlbViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<ViewerState | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d111a)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000)
    camera.position.set(2, 2, 2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    containerRef.current.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const ambient = new THREE.AmbientLight(0xffffff, 0.65)
    scene.add(ambient)

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85)
    keyLight.position.set(5, 8, 4)
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.4)
    rimLight.position.set(-6, 3, -4)
    scene.add(rimLight)

    const loader = new GLTFLoader()

    const viewerState: ViewerState = {
      renderer,
      scene,
      camera,
      controls,
      loader,
      animationId: null,
      currentObject: null,
    }

    viewerRef.current = viewerState

    const animate = () => {
      viewerState.controls.update()
      viewerState.renderer.render(viewerState.scene, viewerState.camera)
      viewerState.animationId = requestAnimationFrame(animate)
    }

    animate()

    const resize = () => {
      if (!containerRef.current) return
      const { clientWidth, clientHeight } = containerRef.current
      viewerState.camera.aspect = clientWidth / clientHeight
      viewerState.camera.updateProjectionMatrix()
      viewerState.renderer.setSize(clientWidth, clientHeight)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (viewerState.animationId) cancelAnimationFrame(viewerState.animationId)
      viewerState.controls.dispose()
      viewerState.renderer.dispose()
      if (viewerState.renderer.domElement.parentElement) {
        viewerState.renderer.domElement.parentElement.removeChild(viewerState.renderer.domElement)
      }
    }
  }, [])

  useEffect(() => {
    if (!viewerRef.current) return
    const viewer = viewerRef.current

    if (viewer.currentObject) {
      viewer.scene.remove(viewer.currentObject)
      disposeObject(viewer.currentObject)
      viewer.currentObject = null
    }

    if (glbUrl) {
      viewer.loader.load(
        glbUrl,
        (gltf: { scene: any }) => {
          viewer.currentObject = gltf.scene
          viewer.scene.add(gltf.scene)
          fitCameraToObject(viewer.camera, viewer.controls, gltf.scene)
        },
        undefined,
        (error: unknown) => {
          console.error('GLB load error', error)
        },
      )
      return
    }

    if (!glb) return

    const arrayBuffer = new Uint8Array(glb).buffer

    viewer.loader.parse(
      arrayBuffer,
      '',
      (gltf: { scene: any }) => {
        viewer.currentObject = gltf.scene
        viewer.scene.add(gltf.scene)
        fitCameraToObject(viewer.camera, viewer.controls, gltf.scene)
      },
      (error: unknown) => {
        console.error('GLB load error', error)
      },
    )
  }, [glb, glbUrl])

  const placeholder = useMemo(() => {
    if (isLoading) return 'Building model...'
    if (emptyMessage) return emptyMessage
    return 'Model will appear here after download.'
  }, [emptyMessage, isLoading])

  const showOverlay = isLoading || (!glb && !glbUrl)

  return (
    <div className="viewer">
      <div className="viewer__canvas" ref={containerRef} />
      {showOverlay ? (
        <div className={`viewer__overlay px-5 text-center ${isLoading ? 'viewer__overlay--loading' : ''}`}>{placeholder}</div>
      ) : null}
    </div>
  )
}

function fitCameraToObject(camera: any, controls: OrbitControls, object: any) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = (camera.fov * Math.PI) / 180
  let cameraZ = Math.abs(maxDim / Math.sin(fov / 2))
  cameraZ *= 0.55

  camera.position.set(center.x + cameraZ, center.y + cameraZ, center.z + cameraZ)
  camera.near = Math.max(0.01, maxDim / 100)
  camera.far = maxDim * 100
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}

function disposeObject(object: any) {
  object.traverse((child: any) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      if (Array.isArray(child.material)) {
        child.material.forEach((material: any) => material.dispose())
      } else {
        child.material.dispose()
      }
    }
  })
}

export default GlbViewer
