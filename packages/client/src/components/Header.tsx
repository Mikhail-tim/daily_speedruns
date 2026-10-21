import React from "react";

interface HeaderProps {
  nickname: string;
  dateStr?: string;
  onEditNickname: () => void;
}

export const Header: React.FC<HeaderProps> = ({ nickname, dateStr, onEditNickname }) => {
  return (
    <header className="site-header">
      <div className="brand-wrapper">
        <div className="brand-icon">⚡</div>
        <span className="brand-title">Daily Speedruns</span>
        {dateStr && <span className="brand-date-badge">{dateStr}</span>}
      </div>

      <div className="header-user-actions">
        <button
          className="nickname-pill"
          onClick={onEditNickname}
          title="Click to customize your runner nickname"
          aria-label="Edit nickname"
        >
          <span className="user-avatar-dot" />
          <span className="nickname-text">{nickname}</span>
          <span className="edit-icon">✎</span>
        </button>
      </div>
    </header>
  );
};
