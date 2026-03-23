import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

const Header = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { to: "/", label: "[HOME]" },
    { to: "/createroom", label: "[HOST]" },
    { to: "/join", label: "[JOIN]" },
  ];

  return (
    <header className="bg-cyber-black border-b border-neon-green/20 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 border border-neon-green/50 flex items-center justify-center group-hover:border-neon-green group-hover:shadow-neon transition-all">
              <span className="text-neon-green font-bold text-sm">▸</span>
            </div>
            <span className="text-neon-green font-display text-lg tracking-wider text-glow">BEAMIT</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-2 text-xs font-mono font-bold tracking-wider transition-all duration-150 ${
                  location.pathname === to
                    ? "text-neon-green border-b-2 border-neon-green text-glow"
                    : "text-cyber-gray hover:text-neon-green"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          <button
            className="sm:hidden p-2 text-cyber-gray hover:text-neon-green transition-colors"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="sm:hidden pb-3 flex flex-col gap-1 border-t border-cyber-darkgray">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                className={`px-4 py-2.5 text-xs font-mono font-bold tracking-wider transition-colors ${
                  location.pathname === to
                    ? "text-neon-green text-glow"
                    : "text-cyber-gray hover:text-neon-green"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
