import React from "react";

interface HeaderProps {
  nickname: string;
  dateStr?: string;
  onEditNickname: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  nickname,
  dateStr,
  onEditNickname,
}) => {
  return (
    <header className="arena-header">
      <div className="arena-brand">
        <div className="arena-mark">
          <span>DS</span>
          <i />
        </div>
        <div className="arena-wordmark">
          <span>Daily</span>
          <span>Speedruns</span>
        </div>
      </div>

      <div className="arena-header-center">
        {dateStr && (
          <span className="arena-date">
            {dateStr} <em>/ UTC</em>
          </span>
        )}
        <span className="arena-build">Test build · Arena</span>
      </div>

      <button
        className="arena-runner"
        onClick={onEditNickname}
        title="Click to customize your runner nickname"
        aria-label="Edit nickname"
      >
        <span className="arena-runner-dot" />
        <span className="arena-runner-name">{nickname}</span>
        <span className="arena-runner-edit">Edit</span>
      </button>
    </header>
  );
};
