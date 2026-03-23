import { useState } from "react";

const Toggleable = ({ username, userId }: { username: string; userId: string }) => {
  const [showUserId, setShowUserId] = useState(false);

  return (
    <button
      onClick={() => setShowUserId((p) => !p)}
      title={showUserId ? "Click to see username" : "Click to see user ID"}
      className="inline-flex items-center gap-1.5 group"
    >
      {showUserId ? (
        <span className="font-mono text-[10px] text-neon-green/60 bg-neon-green/5 border border-neon-green/20 px-2 py-0.5 group-hover:border-neon-green/40 transition-colors truncate max-w-[160px]">
          {userId}
        </span>
      ) : (
        <span className="text-sm font-mono font-semibold text-neon-green group-hover:text-glow transition-all">
          {username || "UNKNOWN"}
        </span>
      )}
    </button>
  );
};

export default Toggleable;
