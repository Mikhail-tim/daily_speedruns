import React, { useEffect, useRef, useState } from "react";

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Refresh the local value and focus the field whenever the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setName(currentNickname);
    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isOpen, currentNickname]);

  // Escape closes the dialog without saving.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onSave(trimmed);
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title" id="nickname-modal-title">
          Customize Runner Nickname
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
          This name appears publicly on today's speedrun leaderboard.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <input
            ref={inputRef}
            type="text"
            className="modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            placeholder="e.g. SonicSpeed99"
          />

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim()}>
              Save Nickname
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
