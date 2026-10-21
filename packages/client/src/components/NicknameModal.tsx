import React, { useState } from "react";

interface NicknameModalProps {
  currentNickname: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (newName: string) => void;
}

export const NicknameModal: React.FC<NicknameModalProps> = ({
  currentNickname,
  isOpen,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState(currentNickname);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Customize Runner Nickname</h3>
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
          This name appears publicly on today's speedrun leaderboard.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <input
            type="text"
            className="modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={25}
            placeholder="e.g. SonicSpeed99"
            autoFocus
          />

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Nickname
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
