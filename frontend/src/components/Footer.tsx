const Footer = () => {
  return (
    <footer className="bg-cyber-black border-t border-cyber-darkgray">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-neon-green font-display text-sm">BEAMIT</span>
            <span className="text-cyber-darkgray text-xs font-mono">// P2P TRANSFER PROTOCOL</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-cyber-darkgray text-xs font-mono flex items-center gap-2">
              DEVELOPED BY
              <img src="/profile.png" alt="Profile" className="w-6 h-6 rounded-full object-cover object-center border border-neon-green/50" />
              <span className="text-neon-green/70">SRISAI SHIVAKOTI</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
