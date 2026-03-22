import { useNavigate } from "react-router-dom";

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    title: "End-to-End Encrypted",
    desc: "Files travel directly between browsers — never stored on any server.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    title: "No Size Limits",
    desc: "Stream any file — even 10 GB+ — without memory overflow.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
    title: "Folder Transfer",
    desc: "Upload and share entire folder structures in one action.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: "Multi-Peer Rooms",
    desc: "Connect multiple peers in one room and transfer to any of them.",
  },
];

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <div className="bg-hero-gradient text-white py-20 px-4 text-center">
        <div className="max-w-2xl mx-auto animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm font-medium mb-6">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse-slow"></span>
            WebRTC · No upload · Peer-to-peer
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-4 tracking-tight">
            Share files directly,<br />
            <span className="text-brand-300">no middleman.</span>
          </h1>
          <p className="text-white/70 text-lg mb-10 leading-relaxed max-w-lg mx-auto">
            FileDrop uses WebRTC to stream files straight between browsers — no cloud storage, no size caps, nothing stored.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate("/createroom")}
              className="px-8 py-3.5 bg-white text-brand-700 font-bold rounded-xl hover:bg-brand-50 transition-all shadow-lg hover:shadow-xl text-sm flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                <path stroke="#4f46e5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11v3M10.5 12.5h3" />
              </svg>
              Create a Room
            </button>
            <button
              onClick={() => navigate("/join")}
              className="px-8 py-3.5 bg-white/10 border border-white/25 text-white font-bold rounded-xl hover:bg-white/20 transition-all text-sm flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
              </svg>
              Join a Room
            </button>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-4xl mx-auto w-full px-4 py-16">
        <h2 className="text-center text-2xl font-bold text-slate-800 mb-2">Why FileDrop?</h2>
        <p className="text-center text-slate-500 text-sm mb-10">Built for speed, privacy, and convenience.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <div key={i} className="card p-6 flex gap-4 hover:shadow-card-hover transition-shadow duration-200">
              <div className="flex-shrink-0 w-10 h-10 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center">
                {f.icon}
              </div>
              <div>
                <h3 className="font-bold text-slate-800 mb-1 text-sm">{f.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="bg-brand-900/5 border-t border-slate-200 py-14 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">How it works</h2>
          <p className="text-slate-500 text-sm mb-10">Three steps to transfer any file.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {[
              { step: "1", title: "Create a room", desc: "Pick a name, set it public or private." },
              { step: "2", title: "Share the ID", desc: "Give your Host ID to the other person." },
              { step: "3", title: "Drop and send", desc: "Drag files onto any peer — they arrive instantly." },
            ].map((s) => (
              <div key={s.step} className="flex-1 card p-6 text-center">
                <div className="w-10 h-10 bg-brand-600 text-white font-bold text-lg rounded-full flex items-center justify-center mx-auto mb-3">
                  {s.step}
                </div>
                <h3 className="font-bold text-slate-800 text-sm mb-1">{s.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
