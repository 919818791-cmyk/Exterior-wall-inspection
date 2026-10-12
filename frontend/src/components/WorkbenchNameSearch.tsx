interface WorkbenchNameSearchProps {
  label?: string;
  onChange: (value: string) => void;
  value: string;
}

export function WorkbenchNameSearch({
  label = "搜索检测项目",
  onChange,
  value
}: WorkbenchNameSearchProps) {
  return <div className="project-name-search-toolbar">
    <label className="project-name-search-field floating-line-field">
      <input
        aria-label={label}
        autoComplete="off"
        placeholder=" "
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span>{label}</span>
    </label>
  </div>;
}
