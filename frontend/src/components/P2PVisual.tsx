import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulse: number;
  pulseSpeed: number;
}

interface DataPacket {
  fromIdx: number;
  toIdx: number;
  progress: number;
  speed: number;
}

const P2PVisual = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const w = () => canvas.getBoundingClientRect().width;
    const h = () => canvas.getBoundingClientRect().height;

    // Create nodes
    const NODE_COUNT = 8;
    const nodes: Particle[] = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * 400 + 50,
      y: Math.random() * 300 + 50,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radius: Math.random() * 2 + 3,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.02 + Math.random() * 0.02,
    }));

    // Central hub nodes (sender & receiver)
    nodes[0] = { ...nodes[0], x: 120, y: 200, radius: 6, vx: 0, vy: 0.15, pulseSpeed: 0.03, pulse: 0 };
    nodes[1] = { ...nodes[1], x: 380, y: 200, radius: 6, vx: 0, vy: -0.15, pulseSpeed: 0.03, pulse: Math.PI };

    const packets: DataPacket[] = [];
    let tick = 0;

    const CONNECTION_DIST = 200;

    const draw = () => {
      const cw = w();
      const ch = h();
      ctx.clearRect(0, 0, cw, ch);

      tick++;

      // Update nodes
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += n.pulseSpeed;
        if (n.x < 20 || n.x > cw - 20) n.vx *= -1;
        if (n.y < 20 || n.y > ch - 20) n.vy *= -1;
        n.x = Math.max(20, Math.min(cw - 20, n.x));
        n.y = Math.max(20, Math.min(ch - 20, n.y));
      });

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.3;
            ctx.strokeStyle = `rgba(57, 255, 20, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Main transfer line (node 0 → node 1)
      ctx.strokeStyle = "rgba(57, 255, 20, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      ctx.lineTo(nodes[1].x, nodes[1].y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Spawn packets periodically
      if (tick % 30 === 0) {
        packets.push({ fromIdx: 0, toIdx: 1, progress: 0, speed: 0.015 + Math.random() * 0.01 });
      }
      if (tick % 45 === 0 && nodes.length > 3) {
        const from = Math.floor(Math.random() * (nodes.length - 2)) + 2;
        const to = from === 0 ? 1 : 0;
        packets.push({ fromIdx: from, toIdx: to, progress: 0, speed: 0.01 + Math.random() * 0.01 });
      }

      // Draw & update packets
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.progress += p.speed;
        if (p.progress >= 1) {
          packets.splice(i, 1);
          continue;
        }
        const from = nodes[p.fromIdx];
        const to = nodes[p.toIdx];
        const px = from.x + (to.x - from.x) * p.progress;
        const py = from.y + (to.y - from.y) * p.progress;

        // Glow
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, 8);
        gradient.addColorStop(0, "rgba(57, 255, 20, 0.6)");
        gradient.addColorStop(1, "rgba(57, 255, 20, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = "#39ff14";
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw nodes
      nodes.forEach((n, i) => {
        const pulseSize = Math.sin(n.pulse) * 1.5;
        const r = n.radius + pulseSize;

        // Outer glow
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4);
        glow.addColorStop(0, i < 2 ? "rgba(57, 255, 20, 0.15)" : "rgba(57, 255, 20, 0.08)");
        glow.addColorStop(1, "rgba(57, 255, 20, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 4, 0, Math.PI * 2);
        ctx.fill();

        // Node body
        ctx.fillStyle = i < 2 ? "#39ff14" : "rgba(57, 255, 20, 0.6)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Labels for hub nodes
        if (i < 2) {
          ctx.fillStyle = "rgba(57, 255, 20, 0.5)";
          ctx.font = "9px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText(i === 0 ? "SENDER" : "RECEIVER", n.x, n.y - r - 8);
        }
      });

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.8 }}
      className="relative w-full max-w-lg mx-auto"
    >
      <canvas
        ref={canvasRef}
        className="w-full border border-neon-green/10"
        style={{ height: "320px" }}
      />
      {/* Corner markers */}
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-neon-green/30" />
      <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-neon-green/30" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-neon-green/30" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-neon-green/30" />
      <div className="absolute bottom-2 right-3 text-[9px] font-mono text-neon-green/30 tracking-wider">
        P2P MESH // LIVE
      </div>
    </motion.div>
  );
};

export default P2PVisual;