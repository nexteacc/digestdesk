import { useEffect, useRef } from "react";
import * as THREE from "three";

const vertexShader = `
  precision mediump float;
  uniform vec2 u_resolution;
  out vec2 fragCoord;

  void main() {
    gl_Position = vec4(position, 1.0);
    fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
    fragCoord.y = u_resolution.y - fragCoord.y;
  }
`;

const fragmentShader = `
  precision mediump float;
  in vec2 fragCoord;

  uniform float u_time;
  uniform float u_opacities[10];
  uniform vec3 u_colors[6];
  uniform float u_total_size;
  uniform float u_dot_size;
  uniform vec2 u_resolution;

  out vec4 fragColor;

  float PHI = 1.61803398874989484820459;

  float random(vec2 xy) {
    return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
  }

  void main() {
    vec2 st = fragCoord.xy;
    st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
    st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

    float opacity = step(0.0, st.x) * step(0.0, st.y);
    vec2 grid = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
    float frequency = 5.0;
    float showOffset = random(grid);
    float rand = random(grid * floor((u_time / frequency) + showOffset + frequency));

    opacity *= u_opacities[int(rand * 10.0)];
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

    float distanceFromCenter = distance(u_resolution / 2.0 / u_total_size, grid);
    float timingOffset = distanceFromCenter * 0.01 + random(grid) * 0.15;
    opacity *= step(timingOffset, u_time * 3.0);
    opacity *= clamp((1.0 - step(timingOffset + 0.1, u_time * 3.0)) * 1.25, 1.0, 1.25);

    vec3 color = u_colors[int(showOffset * 6.0)];
    fragColor = vec4(color, opacity);
    fragColor.rgb *= fragColor.a;
  }
`;

export default function DotMatrixBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const resolution = new THREE.Vector2();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const uniforms = {
      u_time: { value: 0 },
      u_resolution: { value: resolution },
      u_opacities: { value: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1] },
      u_colors: {
        value: [
          new THREE.Vector3(1, 1, 1),
          new THREE.Vector3(1, 1, 1),
          new THREE.Vector3(1, 1, 1),
          new THREE.Vector3(1, 1, 1),
          new THREE.Vector3(1, 1, 1),
          new THREE.Vector3(1, 1, 1),
        ],
      },
      u_total_size: { value: 10 * pixelRatio },
      u_dot_size: { value: 3 * pixelRatio },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      glslVersion: THREE.GLSL3,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let animationFrame = 0;
    let startTime = performance.now();

    const resize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      resolution.set(width * pixelRatio, height * pixelRatio);
    };

    const renderFrame = () => {
      uniforms.u_time.value = reducedMotion.matches ? 1 : (performance.now() - startTime) / 1000;
      renderer.render(scene, camera);
    };

    const animate = () => {
      renderFrame();
      animationFrame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(animationFrame);
      if (reducedMotion.matches) {
        renderFrame();
        return;
      }
      startTime = performance.now() - uniforms.u_time.value * 1000;
      animate();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(animationFrame);
        return;
      }
      start();
    };

    resize();
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotion.addEventListener("change", start);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", start);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
}
