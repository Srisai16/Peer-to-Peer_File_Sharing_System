const Footer = () => {
  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-brand-600 rounded-md flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white">FileDrop</span>
            <span className="text-xs text-slate-500">— P2P File Sharing</span>
          </div>

          <div className="flex items-center gap-3">
            <img
              src="/srisai-profile.png"
              alt="Srisai Shivakoti"
              className="w-8 h-8 rounded-full object-cover object-top border-2 border-slate-700"
            />
            <p className="text-xs text-slate-400">
              Developed by <span className="text-white font-semibold">Srisai Shivakoti</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
