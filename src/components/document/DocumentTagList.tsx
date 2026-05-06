interface DocumentTagListProps {
  tags: string[];
}

export function DocumentTagList({ tags }: DocumentTagListProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-[#e7ddd0] px-2.5 py-1 text-[11px] font-medium text-[#67584a]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export default DocumentTagList;