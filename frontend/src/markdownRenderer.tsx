type MarkdownBlock =
  | { type: "code"; language: string; content: string }
  | { type: "paragraph"; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "blockquote"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "rule" };

export function MarkdownRenderer({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) {
    return <div className="markdown-empty">暂无输出</div>;
  }
  return (
    <div className="markdown-body">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdownBlocks(content: string) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^```\s*(\S*)\s*$/);
    if (fenceMatch) {
      const language = fenceMatch[1] || "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].match(/^```\s*$/)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    const listMatch = line.match(/^\s{0,3}(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s{0,3}(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!itemMatch || Boolean(itemMatch[2]) !== ordered) {
          break;
        }
        items.push(itemMatch[3]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (
        lines[index].match(/^```/) ||
        lines[index].match(/^(#{1,6})\s+(.+)$/) ||
        lines[index].match(/^\s{0,3}(?:([-+*])|(\d+)\.)\s+(.+)$/) ||
        lines[index].match(/^\s{0,3}>\s?/)
      ) {
        break;
      }
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join("\n") });
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === "code") {
    return (
      <pre className="markdown-code" key={index}>
        {block.language && <span className="markdown-code-language">{block.language}</span>}
        <code>{block.content}</code>
      </pre>
    );
  }
  if (block.type === "heading") {
    const Tag = `h${block.level}` as keyof JSX.IntrinsicElements;
    return <Tag key={index}>{renderInlineMarkdown(block.content)}</Tag>;
  }
  if (block.type === "blockquote") {
    return <blockquote key={index}>{renderInlineMarkdown(block.content)}</blockquote>;
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
        ))}
      </Tag>
    );
  }
  if (block.type === "rule") {
    return <hr key={index} />;
  }
  return <p key={index}>{renderInlineMarkdown(block.content)}</p>;
}

function renderInlineMarkdown(content: string) {
  const nodes: JSX.Element[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content))) {
    if (match.index > lastIndex) {
      nodes.push(<span key={nodes.length}>{content.slice(lastIndex, match.index)}</span>);
    }
    const value = match[0];
    if (value.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith("**")) {
      nodes.push(<strong key={nodes.length}>{renderInlineMarkdown(value.slice(2, -2))}</strong>);
    } else if (value.startsWith("*")) {
      nodes.push(<em key={nodes.length}>{renderInlineMarkdown(value.slice(1, -1))}</em>);
    } else {
      const linkMatch = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a key={nodes.length} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>,
        );
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < content.length) {
    nodes.push(<span key={nodes.length}>{content.slice(lastIndex)}</span>);
  }
  return nodes;
}
