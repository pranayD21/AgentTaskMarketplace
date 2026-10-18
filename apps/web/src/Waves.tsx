import { useEffect, useRef } from "react";
import fragment from "./waves.frag?raw";

/** The supplied Waves recipe, rendered with a plain WebGL1 fullscreen triangle. */
export function Waves() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    let frame = 0;
    const cleanup = () => {
      cancelAnimationFrame(frame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
    };
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, "attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.0,1.0);}");
    const pixel = compile(gl.FRAGMENT_SHADER, fragment);
    if (!vertex || !pixel || !program || !buffer) { cleanup(); return; }
    gl.attachShader(program, vertex);
    gl.attachShader(program, pixel);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { cleanup(); return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(gl.getUniformLocation(program, "u_colors[0]"), new Float32Array([
      .102, .078, .137, .718, .365, .412, .918, .804, .761, 1, .961, .922,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]));
    for (const [name, values] of Object.entries({
      u_shape: [1.32, .49, .84, .01], u_surface: [1.73, 1.08, .07, 2],
      u_finish: [2.27, 0, .040, .35], u_transform: [4984, 3.37, .40, 1],
      u_space: [-.13, .05, 0, 0], u_cursor: [0, 3, .54, .56],
    })) gl.uniform4fv(gl.getUniformLocation(program, name), values);
    const scene = gl.getUniformLocation(program, "u_scene");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let elapsed = 0, previous = performance.now();
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden || gl.isContextLost()) return;
      if (!motion.matches) elapsed += Math.min(now - previous, 100);
      previous = now;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
      gl.uniform4f(scene, width, height, elapsed / 1000 * -.67, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!motion.matches) frame = requestAnimationFrame(draw);
    };
    const resume = () => { cancelAnimationFrame(frame); previous = performance.now(); draw(previous); };
    const lost = () => cancelAnimationFrame(frame);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("resize", resume);
    motion.addEventListener("change", resume);
    canvas.addEventListener("webglcontextlost", lost);
    resume();
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("resize", resume);
      motion.removeEventListener("change", resume);
      canvas.removeEventListener("webglcontextlost", lost);
      cleanup();
    };
  }, []);
  return <canvas className="landing-waves" ref={ref} aria-hidden="true" />;
}
