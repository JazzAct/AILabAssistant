import { useEffect, useRef } from 'react';

const EVENT_STYLES = {
  THINKING:          { icon: '◎', color: 'var(--color-text-secondary)' },
  FILE_READ:         { icon: '↗', color: 'var(--color-text-info)' },
  FILE_WRITE:        { icon: '✎', color: '#854F0B' },
  BUILD_START:       { icon: '⚙', color: 'var(--color-text-secondary)' },
  BUILD_OUTPUT:      { icon: ' ', color: 'var(--color-text-tertiary)', mono: true },
  BUILD_RESULT:      { icon: '●', color: null },  // dynamic
  FLASH_START:       { icon: '⚡', color: '#854F0B' },
  FLASH_DONE:        { icon: '✓', color: 'var(--color-text-success)' },
  SERIAL_READING:    { icon: '◉', color: 'var(--color-text-info)' },
  JUDGMENT:          { icon: '⊙', color: null },
  ITERATION:         { icon: '↻', color: 'var(--color-text-secondary)' },
  GOAL_ACHIEVED:     { icon: '✓', color: 'var(--color-text-success)' },
  GIVING_UP:         { icon: '✗', color: 'var(--color-text-danger)' },
  AWAITING_APPROVAL: { icon: '⚠', color: 'var(--color-text-warning)' },
  ERROR:             { icon: '✗', color: 'var(--color-text-danger)' },
};

function formatEvent(event) {
  switch (event.type) {
    case 'THINKING':         return event.text;
    case 'FILE_READ':        return `Reading ${event.path}`;
    case 'FILE_WRITE':       return `Writing ${event.path}`;
    case 'BUILD_START':      return 'Running idf.py build...';
    case 'BUILD_OUTPUT':     return event.line;
    case 'BUILD_RESULT':     return event.success ? 'Build successful' : `Build failed (${event.errors?.length} errors)`;
    case 'FLASH_START':      return 'Flashing to device...';
    case 'FLASH_DONE':       return event.success ? 'Flash complete' : 'Flash failed';
    case 'SERIAL_READING':   return `Reading serial for ${event.seconds}s...`;
    case 'JUDGMENT':         return event.pass ? `Goal achieved: ${event.reasoning}` : `Not yet: ${event.reasoning}`;
    case 'ITERATION':        return `Iteration ${event.current} / ${event.max}`;
    case 'GOAL_ACHIEVED':    return `Done: ${event.summary}`;
    case 'GIVING_UP':        return `Stopped: ${event.reason}`;
    case 'AWAITING_APPROVAL': return 'Waiting for your approval to flash...';
    case 'ERROR':            return `Error: ${event.message}`;
    default:                 return JSON.stringify(event);
  }
}

function getColor(event) {
  if (event.type === 'BUILD_RESULT') {
    return event.success ? 'var(--color-text-success)' : 'var(--color-text-danger)';
  }
  if (event.type === 'JUDGMENT') {
    return event.pass ? 'var(--color-text-success)' : 'var(--color-text-warning)';
  }
  return EVENT_STYLES[event.type]?.color || 'var(--color-text-secondary)';
}

export function AgentTransparencyPanel({ events, onApproveFlash, pendingApproval }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    }}>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}>
        {events.length === 0 && (
          <div style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-sans)', fontSize: '13px', padding: '8px 0' }}>
            Agent events will appear here when you start a task...
          </div>
        )}

        {events.map((event, i) => {
          const style = EVENT_STYLES[event.type] || {};
          const color = getColor(event);
          const text = formatEvent(event);
          const isSeparator = event.type === 'ITERATION';
          const isApproval = event.type === 'AWAITING_APPROVAL';

          if (isSeparator) {
            return (
              <div key={i} style={{
                borderTop: '0.5px solid var(--color-border-tertiary)',
                margin: '8px 0 4px',
                paddingTop: '4px',
                color: 'var(--color-text-tertiary)',
                fontSize: '11px',
              }}>
                {text}
              </div>
            );
          }

          if (isApproval) {
            return (
              <div key={i} style={{
                background: 'var(--color-background-warning)',
                border: '0.5px solid var(--color-border-warning)',
                borderRadius: '6px',
                padding: '10px 12px',
                margin: '8px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-sans)',
              }}>
                <span style={{ fontSize: '13px', color: 'var(--color-text-warning)' }}>
                  ⚠ Agent wants to flash the device
                </span>
                <button
                  onClick={onApproveFlash}
                  style={{
                    fontSize: '12px',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    border: '0.5px solid var(--color-border-warning)',
                    background: 'var(--color-background-primary)',
                    color: 'var(--color-text-warning)',
                    cursor: 'pointer',
                    fontWeight: '500',
                  }}
                >
                  Yes, flash it
                </button>
              </div>
            );
          }

          // BUILD_OUTPUT lines are compact
          if (event.type === 'BUILD_OUTPUT') {
            return (
              <div key={i} style={{ color, paddingLeft: '16px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                {text}
              </div>
            );
          }

          return (
            <div key={i} style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
              lineHeight: 1.5,
              color,
            }}>
              <span style={{ opacity: 0.7, flexShrink: 0 }}>{style.icon || '·'}</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
