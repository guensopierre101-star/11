import React from 'react';

interface TapWordTextProps {
  text: string;
  context?: string;
  onWordClick: (word: string, context: string) => void;
}

export const TapWordText: React.FC<TapWordTextProps> = ({ text, context, onWordClick }) => {
  const fullContext = context || text;
  // Match English words including contractions/hyphens
  const regex = /([A-Za-z]+(?:['’][A-Za-z]+)?(?:-[A-Za-z]+)*)/g;
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) => {
        if (regex.test(part)) {
          return (
            <span
              key={i}
              className="tap-word"
              onClick={() => onWordClick(part, fullContext)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onWordClick(part, fullContext);
                }
              }}
            >
              {part}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
};
