const PARTICLES_PER_SIDE = 60;
const CELEBRATION_DURATION = 2_800;
const MAX_DEVICE_PIXEL_RATIO = 2;
const GRAVITY = 760;
const COLORS = ['#73e7ff', '#71f0b7', '#ffcc70', '#ff667f', '#a88dff', '#eef8ff'] as const;

type ParticleShape = 'paper' | 'ribbon' | 'spark';
type CelebrationState = 'idle' | 'running' | 'static';

interface CelebrationParticle {
  readonly originX: number;
  readonly originY: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly delay: number;
  readonly lifetime: number;
  readonly rotation: number;
  readonly rotationSpeed: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly shape: ParticleShape;
  readonly waveOffset: number;
}

export class VictoryCelebration {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D | null;
  readonly #motionPreference: MediaQueryList;
  readonly #listeners = new AbortController();
  #particles: readonly CelebrationParticle[] = [];
  #animationFrame: number | null = null;
  #startedAt = 0;
  #state: CelebrationState = 'idle';
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
    this.#motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.#canvas.dataset.celebration = 'idle';

    const signal = this.#listeners.signal;
    window.addEventListener('resize', () => this.handleResize(), { signal });
    this.#motionPreference.addEventListener('change', () => this.handleMotionPreferenceChange(), {
      signal,
    });
  }

  play(): void {
    this.stop();
    if (this.#context === null) return;

    this.resizeCanvas();
    this.#particles = this.createParticles();
    if (this.#motionPreference.matches) {
      this.#state = 'static';
      this.#canvas.dataset.celebration = 'static';
      this.drawScene(760, true);
      return;
    }

    this.#state = 'running';
    this.#canvas.dataset.celebration = 'running';
    this.#startedAt = performance.now();
    this.#animationFrame = window.requestAnimationFrame((timestamp) => this.animate(timestamp));
  }

  stop(): void {
    if (this.#animationFrame !== null) {
      window.cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }
    this.#state = 'idle';
    this.#particles = [];
    this.#canvas.dataset.celebration = 'idle';
    this.clearCanvas();
  }

  destroy(): void {
    this.stop();
    this.#listeners.abort();
  }

  private animate(timestamp: number): void {
    const elapsed = timestamp - this.#startedAt;
    this.drawScene(elapsed, false);
    if (elapsed >= CELEBRATION_DURATION) {
      this.stop();
      return;
    }
    this.#animationFrame = window.requestAnimationFrame((nextTimestamp) =>
      this.animate(nextTimestamp),
    );
  }

  private drawScene(elapsed: number, staticFrame: boolean): void {
    const context = this.#context;
    if (context === null) return;
    this.clearCanvas();
    this.drawCracker(context, this.#width * 0.08, this.#height * 0.84, 1, elapsed, staticFrame);
    this.drawCracker(context, this.#width * 0.92, this.#height * 0.84, -1, elapsed, staticFrame);
    for (const particle of this.#particles) {
      this.drawParticle(context, particle, elapsed, staticFrame);
    }
  }

  private drawCracker(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    direction: 1 | -1,
    elapsed: number,
    staticFrame: boolean,
  ): void {
    const flash = staticFrame ? 0.75 : Math.max(0, 1 - elapsed / 560);
    const burstOpacity = staticFrame ? 1 : Math.max(0, 1 - elapsed / 1_650);
    context.save();
    context.translate(x, y);
    context.scale(direction, 1);
    context.rotate(-0.72);

    if (flash > 0) {
      const glow = context.createRadialGradient(0, 0, 0, 0, 0, 90);
      glow.addColorStop(0, `rgba(255, 245, 190, ${0.72 * flash})`);
      glow.addColorStop(0.4, `rgba(115, 231, 255, ${0.28 * flash})`);
      glow.addColorStop(1, 'rgba(115, 231, 255, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(0, 0, 90, 0, Math.PI * 2);
      context.fill();
    }

    this.drawPartyPopperBurst(context, burstOpacity);
    this.tracePartyPopperBody(context);
    context.fillStyle = '#ffd45f';
    context.fill();

    context.save();
    this.tracePartyPopperBody(context);
    context.clip();
    for (const band of [
      { center: -62, color: '#ff667f' },
      { center: -42, color: '#73e7ff' },
      { center: -21, color: '#a88dff' },
    ]) {
      context.fillStyle = band.color;
      context.beginPath();
      context.moveTo(band.center - 10, -38);
      context.lineTo(band.center + 4, -38);
      context.lineTo(band.center + 22, 38);
      context.lineTo(band.center + 8, 38);
      context.closePath();
      context.fill();
    }
    context.restore();

    this.tracePartyPopperBody(context);
    context.strokeStyle = '#33254d';
    context.lineWidth = 4;
    context.lineJoin = 'round';
    context.stroke();

    context.fillStyle = '#fff0a6';
    context.beginPath();
    context.ellipse(-8, 0, 7, 30, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#33254d';
    context.lineWidth = 4;
    context.stroke();

    context.fillStyle = '#ff8fa1';
    context.beginPath();
    context.arc(-82, 0, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private tracePartyPopperBody(context: CanvasRenderingContext2D): void {
    context.beginPath();
    context.moveTo(-82, 0);
    context.lineTo(-10, -29);
    context.quadraticCurveTo(2, 0, -10, 29);
    context.closePath();
  }

  private drawPartyPopperBurst(context: CanvasRenderingContext2D, opacity: number): void {
    context.save();
    context.globalAlpha = opacity;
    context.lineCap = 'round';
    context.lineWidth = 4;

    for (const ribbon of [
      { color: '#73e7ff', points: [8, -6, 30, -54, 54, -22, 70, -62] },
      { color: '#ff667f', points: [10, 2, 42, -12, 34, 32, 76, 20] },
      { color: '#a88dff', points: [5, 8, 20, 48, 52, 23, 64, 54] },
    ] as const) {
      context.strokeStyle = ribbon.color;
      context.beginPath();
      context.moveTo(ribbon.points[0], ribbon.points[1]);
      context.bezierCurveTo(
        ribbon.points[2],
        ribbon.points[3],
        ribbon.points[4],
        ribbon.points[5],
        ribbon.points[6],
        ribbon.points[7],
      );
      context.stroke();
    }

    this.drawStar(context, 38, -48, 10, '#ffcc70', 0.2);
    this.drawStar(context, 68, -8, 8, '#71f0b7', -0.15);
    this.drawStar(context, 31, 42, 7, '#eef8ff', 0.45);

    context.fillStyle = '#ff667f';
    context.fillRect(78, -42, 10, 10);
    context.fillStyle = '#73e7ff';
    context.beginPath();
    context.arc(87, 30, 6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawStar(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    rotation: number,
  ): void {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.fillStyle = color;
    context.beginPath();
    for (let point = 0; point < 8; point += 1) {
      const angle = (Math.PI * point) / 4 - Math.PI / 2;
      const pointRadius = point % 2 === 0 ? radius : radius * 0.42;
      const pointX = Math.cos(angle) * pointRadius;
      const pointY = Math.sin(angle) * pointRadius;
      if (point === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawParticle(
    context: CanvasRenderingContext2D,
    particle: CelebrationParticle,
    elapsed: number,
    staticFrame: boolean,
  ): void {
    const age = staticFrame
      ? Math.max(0.2, (elapsed - particle.delay * 0.35) / 1_000)
      : (elapsed - particle.delay) / 1_000;
    if (age < 0 || age > particle.lifetime) return;

    const progress = age / particle.lifetime;
    const opacity = staticFrame ? 0.92 : Math.min(1, (1 - progress) * 2.8);
    const x =
      particle.originX + particle.velocityX * age + Math.sin(age * 7 + particle.waveOffset) * 12;
    const y = particle.originY + particle.velocityY * age + GRAVITY * age * age * 0.5;
    const rotation = particle.rotation + particle.rotationSpeed * age;

    context.save();
    context.globalAlpha = opacity;
    context.translate(x, y);
    context.rotate(rotation);
    context.fillStyle = particle.color;
    context.strokeStyle = particle.color;

    if (particle.shape === 'spark') {
      context.beginPath();
      context.arc(0, 0, particle.width * 0.45, 0, Math.PI * 2);
      context.fill();
    } else if (particle.shape === 'ribbon') {
      context.lineWidth = Math.max(2, particle.width * 0.28);
      context.beginPath();
      context.moveTo(-particle.width, -particle.height * 0.5);
      context.bezierCurveTo(
        particle.width,
        -particle.height * 0.15,
        -particle.width,
        particle.height * 0.15,
        particle.width,
        particle.height * 0.5,
      );
      context.stroke();
    } else {
      const squash = Math.max(0.22, Math.abs(Math.cos(rotation)));
      context.scale(squash, 1);
      context.fillRect(
        -particle.width * 0.5,
        -particle.height * 0.5,
        particle.width,
        particle.height,
      );
    }
    context.restore();
  }

  private createParticles(): readonly CelebrationParticle[] {
    const particles: CelebrationParticle[] = [];
    for (const direction of [1, -1] as const) {
      const originX = this.#width * (direction === 1 ? 0.08 : 0.92);
      const originY = this.#height * 0.84;
      for (let index = 0; index < PARTICLES_PER_SIDE; index += 1) {
        const speed = randomBetween(470, 900);
        const angle = randomBetween(0.62, 1.28);
        const shapeRoll = index % 7;
        particles.push({
          originX,
          originY,
          velocityX: Math.cos(angle) * speed * direction,
          velocityY: -Math.sin(angle) * speed,
          delay: randomBetween(0, 340),
          lifetime: randomBetween(1.7, 2.65),
          rotation: randomBetween(0, Math.PI * 2),
          rotationSpeed: randomBetween(-9, 9),
          width: randomBetween(5, 12),
          height: randomBetween(9, 20),
          color: COLORS[index % COLORS.length]!,
          shape: shapeRoll === 0 ? 'spark' : shapeRoll < 3 ? 'ribbon' : 'paper',
          waveOffset: randomBetween(0, Math.PI * 2),
        });
      }
    }
    return particles;
  }

  private handleResize(): void {
    if (this.#state === 'idle' || this.#context === null) return;
    this.resizeCanvas();
    this.#particles = this.createParticles();
    if (this.#state === 'static') {
      this.drawScene(760, true);
      return;
    }
    this.#startedAt = performance.now();
  }

  private handleMotionPreferenceChange(): void {
    if (this.#state !== 'idle') this.play();
  }

  private resizeCanvas(): void {
    this.#width = Math.max(1, window.innerWidth);
    this.#height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    this.#canvas.width = Math.round(this.#width * pixelRatio);
    this.#canvas.height = Math.round(this.#height * pixelRatio);
    this.#context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  private clearCanvas(): void {
    this.#context?.clearRect(0, 0, this.#width, this.#height);
  }
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}
