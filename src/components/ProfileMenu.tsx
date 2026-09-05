import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Check } from 'lucide-react';
import type { User } from 'firebase/auth';

/**
 * The account control — one avatar, one menu.
 *
 * The navbar previously kept the avatar, the display name, the entry count and
 * a separate sign-out button all in the top row, permanently. Four elements
 * for a thing a user touches once a session, competing with the actions they
 * touch constantly.
 *
 * They live behind the avatar now. Identity is the affordance people already
 * look for, and the model badge moves here too: which model answered is a
 * property of the session, not part of the product's name.
 *
 * Anchored to its trigger (Apple: a menu emerges from what opened it), so the
 * relationship between the avatar and the panel is visible rather than
 * inferred.
 */
export const ProfileMenu: React.FC<{
  user: User;
  entryCount: number;
  modelLabel?: string;
  onSignOut: () => void;
}> = ({ user, entryCount, modelLabel, onSignOut }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className="block cursor-pointer rounded-full ring-offset-2 ring-offset-[#ffffff] transition-shadow hover:ring-2 hover:ring-[#d4d4d4]"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-full border border-[#d4d4d4] object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e5e5e5] bg-[#f7f7f8] text-xs font-semibold text-[#1a1a1a]">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          /* Scales from the avatar, not from its own centre. */
          style={{ transformOrigin: 'top right' }}
          className="anim-panel absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.16)]"
        >
          <div className="border-b border-[#f0f0f0] px-4 py-3">
            <p className="truncate text-sm font-medium text-[#1a1a1a]">
              {user.displayName || 'Signed in'}
            </p>
            {user.email && (
              <p className="mt-0.5 truncate text-xs text-[#6b6b6b]">{user.email}</p>
            )}
          </div>

          <div className="border-b border-[#f0f0f0] px-4 py-2.5 text-xs text-[#6b6b6b]">
            <div className="flex items-center justify-between">
              <span>Reflections</span>
              <span className="font-medium text-[#3f3f3f]">{entryCount}</span>
            </div>
            {modelLabel && (
              <div className="mt-1.5 flex items-center justify-between">
                <span>Model</span>
                <span className="inline-flex items-center gap-1 font-medium text-[#3f3f3f]">
                  <Check className="h-3 w-3 text-[#1a1a1a]" />
                  {modelLabel}
                </span>
              </div>
            )}
          </div>

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left text-sm text-[#3f3f3f] transition-colors hover:bg-[#f7f7f8]"
          >
            <LogOut className="h-4 w-4 shrink-0 text-[#1a1a1a]" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};
