import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

const GENRES = [
  "Select a category",
  "Software & Apps",
  "Files & Documents",
  "Photos & Media",
  "Music",
  "Movies & Video",
  "Design & Graphics",
  "Books & Research",
  "Gaming",
  "Business & Finance",
  "Science & Research",
  "Other",
];

const CreateRoom = () => {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [genre, setGenre] = useState("Select a category");
  const [username, setUsername] = useState("");

  const handleCreate = () => {
    if (!roomName.trim()) return alert("Room name is required.");
    if (genre === "Select a category") return alert("Please select a category.");
    if (!username.trim()) return alert("Display name is required.");
    navigate("/host", { state: { roomName: roomName.trim(), isPublic, genre, username: username.trim() } });
  };

  return (
    <div className="flex flex-col w-full bg-cyber-black min-h-screen py-10 px-4 grid-bg">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-xl mx-auto w-full"
      >
        <div className="mb-8">
          <p className="text-xs font-mono text-neon-green/50 uppercase tracking-[0.3em] mb-1">// INITIALIZE</p>
          <h1 className="text-2xl font-display text-neon-green text-glow">CREATE ROOM</h1>
          <p className="text-cyber-gray text-xs font-mono mt-2">Configure your transfer session parameters.</p>
        </div>

        <div className="card p-8 space-y-6">
          {/* Room name */}
          <div>
            <label className="label">ROOM_NAME</label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. project-handoff-2025"
              className="input-field"
            />
          </div>

          {/* Visibility toggle */}
          <div>
            <label className="label">VISIBILITY</label>
            <div className="flex gap-3">
              <button
                onClick={() => setIsPublic(true)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-mono font-bold tracking-wider transition-all border ${
                  isPublic
                    ? "border-neon-green bg-neon-green/10 text-neon-green"
                    : "border-cyber-darkgray text-cyber-gray hover:border-cyber-gray"
                }`}
              >
                ◉ PUBLIC
              </button>
              <button
                onClick={() => setIsPublic(false)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-mono font-bold tracking-wider transition-all border ${
                  !isPublic
                    ? "border-neon-green bg-neon-green/10 text-neon-green"
                    : "border-cyber-darkgray text-cyber-gray hover:border-cyber-gray"
                }`}
              >
                ◎ PRIVATE
              </button>
            </div>
            <p className="text-[10px] text-cyber-darkgray font-mono mt-1.5">
              {isPublic ? "→ Listed in public room directory" : "→ Accessible only via room ID"}
            </p>
          </div>

          {/* Category */}
          <div>
            <label className="label">CATEGORY</label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="input-field appearance-none cursor-pointer"
            >
              {GENRES.map((g) => (
                <option key={g} value={g} className="bg-cyber-black text-neon-green">{g}</option>
              ))}
            </select>
          </div>

          {/* Display name */}
          <div>
            <label className="label">DISPLAY_NAME</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-handle"
              className="input-field"
            />
          </div>

          <button onClick={handleCreate} className="btn-primary w-full py-3.5 text-sm">
            ▸ INITIALIZE ROOM
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default CreateRoom;
