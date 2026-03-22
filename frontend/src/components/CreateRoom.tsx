import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
    <div className="flex flex-col w-full bg-slate-100 min-h-screen py-10 px-4">
      <div className="max-w-xl mx-auto w-full animate-slide-up">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Create a Room</h1>
          <p className="text-slate-500 text-sm mt-1">Set up your sharing session and invite others with your Host ID.</p>
        </div>

        <div className="card p-8 space-y-6">
          {/* Room name */}
          <div>
            <label className="label">
              Room Name
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </span>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Project Handoff Files"
                className="input-field pl-10"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">Visible to others if your room is public.</p>
          </div>

          {/* Visibility toggle */}
          <div>
            <label className="label">Visibility</label>
            <div className="flex gap-3">
              <button
                onClick={() => setIsPublic(true)}
                className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                  isPublic
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                </svg>
                Public
              </button>
              <button
                onClick={() => setIsPublic(false)}
                className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                  !isPublic
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Private
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              {isPublic ? "Anyone can find this room in the public list." : "Only joinable via Host ID."}
            </p>
          </div>

          {/* Category */}
          <div>
            <label className="label">Category</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              </span>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="input-field pl-10 appearance-none cursor-pointer"
              >
                {GENRES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="label">Your Display Name</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="How others will see you"
                className="input-field pl-10"
              />
            </div>
          </div>

          <button
            onClick={handleCreate}
            className="btn-primary w-full py-3.5 text-base"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
            </svg>
            Create Room
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateRoom;
