import { useId, type ReactNode } from 'react';

interface SettingRowProps {
  label: ReactNode;
  help?: ReactNode;
  /** Shown under the help text, such as a warning or a result message. */
  details?: ReactNode;
  /** Spans both columns of a two-column card. */
  wide?: boolean;
  /** Receives the id for the main control, so the label names it. */
  children: (controlId: string) => ReactNode;
}

/** One setting: its name and explanation on the left, its control on the right. */
export function SettingRow({ label, help, details, wide, children }: SettingRowProps) {
  const id = useId();
  return (
    <div className={wide ? 'settings-row settings-row-wide' : 'settings-row'}>
      <div className="settings-row-text">
        <label htmlFor={id} className="settings-row-label">{label}</label>
        {help && <span className="help-text">{help}</span>}
        {details}
      </div>
      <div className="settings-row-control">{children(id)}</div>
    </div>
  );
}

interface SwitchRowProps {
  label: ReactNode;
  help?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  wide?: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off setting, shown as a switch. */
export function SwitchRow({ label, help, checked, disabled, wide, onChange }: SwitchRowProps) {
  return (
    <SettingRow label={label} help={help} wide={wide}>
      {(id) => (
        <input
          id={id}
          type="checkbox"
          className="settings-switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </SettingRow>
  );
}
