import * as THREE from 'three';

// Pixels per eye against the headset's own default, fixed when the session
// starts. The second lever if the headset drops frames: try 0.8.
const FRAMEBUFFER_SCALE = 1;
const FOV_TALL_DEG = 60;
const FOV_ACROSS_DEG = 55;

// Vertical field of view for a window. Wide windows keep 60 degrees tall; a
// portrait phone at 60 tall saw only about 30 across, which cut the questions
// and the outer prints off, so it keeps about 55 across instead.
function windowFov(aspect) {
  const across = Math.tan((FOV_ACROSS_DEG * Math.PI) / 360);
  // never narrower than 60 tall, so near-square windows do not jump in
  return Math.min(100, Math.max(FOV_TALL_DEG, (2 * Math.atan(across / aspect) * 180) / Math.PI));
}

// Renderer, scene and camera, shared by the darkroom and the memories.
// On a headset WebXR drives the camera; on a laptop or phone the desktop
// controls do.
export class Stage {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFoveation(1);
    this.renderer.xr.setFramebufferScaleFactor(FRAMEBUFFER_SCALE);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c0907');

    this.camera = new THREE.PerspectiveCamera(windowFov(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.03, 200);
    this.camera.position.set(0, 1.6, 0);
    this.scene.add(this.camera);

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this._headPos = new THREE.Vector3();
    this._headQuat = new THREE.Quaternion();

    window.addEventListener('resize', () => this.resize());
  }

  get presenting() {
    return this.renderer.xr.isPresenting;
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    // in a headset three sets the view from the headset's own projection
    if (!this.renderer.xr.isPresenting) this.camera.fov = windowFov(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // World pose of the eyes. In a headset it is read from this frame's viewer
  // pose: three only updates its XR camera while rendering, so on the first
  // frame of a session the camera still sits at the floor origin.
  head() {
    if (!this.presenting) {
      this.camera.getWorldPosition(this._headPos);
      this.camera.getWorldQuaternion(this._headQuat);
      this.hasPose = true;
    } else {
      let pose = null;
      try {
        pose = this.xrFrame?.getViewerPose(this.renderer.xr.getReferenceSpace());
      } catch {
        // the frame is no longer active; keep the last pose
      }
      if (pose) {
        const { position: p, orientation: o } = pose.transform;
        this._headPos.set(p.x, p.y, p.z);
        this._headQuat.set(o.x, o.y, o.z, o.w);
        this.hasPose = true;
      }
    }
    return { position: this._headPos, quaternion: this._headQuat };
  }

  start(onFrame) {
    this.renderer.setAnimationLoop((time, frame) => {
      this.xrFrame = frame || null;
      this.timer.update(time);
      const dt = Math.min(0.1, this.timer.getDelta());
      // a frame that throws still draws, so the headset never freezes on its
      // last image and the ?debug readout can show the error
      try {
        onFrame(dt, this.timer.getElapsed(), frame);
      } catch (err) {
        console.error(err);
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  async enterXR() {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
    });
    await this.renderer.xr.setSession(session);
    return session;
  }
}

export async function xrSupported() {
  try {
    return Boolean(navigator.xr) && (await navigator.xr.isSessionSupported('immersive-vr'));
  } catch {
    return false;
  }
}
