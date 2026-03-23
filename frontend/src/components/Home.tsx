import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

const features = [
  {
    icon: "🔒",
    title: "E2E ENCRYPTED",
    desc: "DTLS encryption via WebRTC. Files never touch a server. Zero-knowledge architecture.",
    tag: "SECURITY",
  },
  {
    icon: "⚡",
    title: "NO SIZE LIMITS",
    desc: "Stream-based chunked transfer. 10GB, 100GB, or TB-scale — no memory overflow.",
    tag: "PERFORMANCE",
  },
  {
    icon: "📁",
    title: "FOLDER TRANSFER",
    desc: "Upload entire directory structures. Metadata preserved. One-click send.",
    tag: "CAPABILITY",
  },
  {
    icon: "👥",
    title: "MULTI-PEER ROOMS",
    desc: "Connect multiple peers simultaneously. Transfer to one, many, or all.",
    tag: "NETWORK",
  },
];

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <div className="relative bg-cyber-black py-24 px-4 overflow-hidden grid-bg scanlines">
        <div className="absolute inset-0 bg-gradient-to-b from-neon-green/5 via-transparent to-transparent pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center relative z-10"
        >
          <div className="inline-flex items-center gap-2 border border-neon-green/30 px-4 py-1.5 text-xs font-mono font-bold text-neon-green/70 mb-8 tracking-widest">
            <span className="w-2 h-2 bg-neon-green rounded-full animate-pulse-slow" />
            WEBRTC • PEER-TO-PEER • ENCRYPTED
          </div>

          <h1 className="text-4xl sm:text-6xl font-display text-neon-green text-glow leading-tight mb-6 tracking-tight">
            BEAM FILES<br />
            <span className="text-cyber-gray">DIRECTLY.</span>
          </h1>

          <p className="text-cyber-gray font-mono text-sm sm:text-base mb-12 leading-relaxed max-w-xl mx-auto">
            &gt; No cloud. No limits. No middleman.<br />
            &gt; Stream files at maximum bandwidth through encrypted WebRTC channels.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/createroom")}
              className="btn-primary text-sm px-8 py-3.5"
            >
              ▸ CREATE ROOM
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/join")}
              className="btn-secondary text-sm px-8 py-3.5"
            >
              ▸ JOIN ROOM
            </motion.button>
          </div>

          {/* Terminal-style status line */}
          <div className="mt-16 font-mono text-xs text-cyber-darkgray border border-cyber-darkgray/40 p-3 text-left max-w-md mx-auto">
            <p><span className="text-neon-green/50">$</span> beamit --status</p>
            <p className="text-neon-green/40 mt-1">→ Protocol: WebRTC DataChannel</p>
            <p className="text-neon-green/40">→ Encryption: DTLS 1.3</p>
            <p className="text-neon-green/40">→ Max File Size: ∞</p>
            <p className="text-neon-green/40">→ Server Storage: NONE</p>
            <p className="text-neon-green mt-1">✓ Ready to transfer<span className="animate-pulse">_</span></p>
          </div>
        </motion.div>
      </div>

      {/* Features */}
      <div className="bg-cyber-surface border-t border-cyber-darkgray/40 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-xs font-mono text-neon-green/50 uppercase tracking-[0.3em] mb-2">// CAPABILITIES</p>
          <h2 className="text-center text-2xl font-display text-neon-green mb-12">SYSTEM SPECS</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
                className="card p-6 hover:border-neon-green/30 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl">{f.icon}</div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-mono font-bold text-neon-green text-sm">{f.title}</h3>
                      <span className="badge border-neon-green/20 text-neon-green/40">{f.tag}</span>
                    </div>
                    <p className="text-cyber-gray text-xs leading-relaxed font-mono">{f.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-cyber-black border-t border-cyber-darkgray/40 py-20 px-4 grid-bg">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-mono text-neon-green/50 uppercase tracking-[0.3em] mb-2">// PROTOCOL</p>
          <h2 className="text-2xl font-display text-neon-green mb-12">TRANSFER SEQUENCE</h2>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {[
              { step: "01", title: "INIT ROOM", desc: "Create a session. Get your unique room ID." },
              { step: "02", title: "SHARE ID", desc: "Send the room ID to your peer over any channel." },
              { step: "03", title: "BEAM FILES", desc: "Drop files. Direct P2P transfer begins instantly." },
            ].map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.15 }}
                viewport={{ once: true }}
                className="flex-1 card p-6 text-center"
              >
                <div className="text-3xl font-display text-neon-green/20 mb-3">{s.step}</div>
                <h3 className="font-mono font-bold text-neon-green text-sm mb-2">{s.title}</h3>
                <p className="text-cyber-gray text-xs font-mono leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
