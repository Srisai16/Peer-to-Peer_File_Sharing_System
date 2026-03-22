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
        <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 group-hover:bg-slate-200 transition-colors truncate max-w-[160px]">
          {userId}
        </span>
      ) : (
        <span className="text-sm font-semibold text-slate-800 group-hover:text-brand-600 transition-colors">
          {username || "Unknown"}
        </span>
      )}
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
        <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
      </svg>
    </button>
  );
};

export default Toggleable;
