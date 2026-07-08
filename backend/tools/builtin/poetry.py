from langchain.tools import tool

BASE_URL = "https://poetry.palemoky.com/api"


def _fmt_poem(p: dict) -> str:
    """Format a poem dict into readable text."""
    title = p.get("title", "未知")
    author = p.get("author", {}).get("name", "未知")
    dynasty = p.get("dynasty", {}).get("name", "")
    ptype = p.get("type", {}).get("name", "")
    content = p.get("content", [])
    lines = [f"《{title}》"]
    meta = author
    if dynasty:
        meta += f" · {dynasty}"
    if ptype:
        meta += f" · {ptype}"
    lines.append(meta)
    lines.append("")
    for line in content:
        lines.append(line)
    return "\n".join(lines)


@tool
def poetry_search(query: str, search_type: str = "all") -> str:
    """
    Search Chinese poems by keyword. Supports Tang, Song, Yuan poetry, nearly 400k poems.
    Note: query must be at least 3 characters long. For 2-char author names, try adding a character like the dynasty name.
    Args:
        query: search keyword (min 3 chars), e.g. poem title, author name, or content phrase
        search_type: "all" (default), "title", "content", or "author"
    """
    import httpx
    try:
        r = httpx.get(f"{BASE_URL}/search", params={
            "q": query,
            "lang": "zh-Hans",
        }, timeout=15)
        r.raise_for_status()
        data = r.json()
        poems = data.get("data", [])
        if not poems:
            return f"未找到与「{query}」相关的诗词。"
        results = []
        for p in poems[:5]:
            title = p.get("title", "?")
            author = p.get("author", {}).get("name", "?")
            dynasty = p.get("dynasty", {}).get("name", "")
            content = p.get("content", [])
            preview = " · ".join(filter(None, [author, dynasty]))
            text = f"《{title}》— {preview}\n" + "\n".join(content)
            results.append(text)
        header = f"搜索「{query}」找到 {len(poems)} 首：\n\n"
        return header + "\n\n---\n\n".join(results)
    except Exception as e:
        return f"诗词搜索出错: {e}"


@tool
def poetry_random() -> str:
    """
    Get a random Chinese poem. No parameters needed.
    """
    import httpx
    try:
        r = httpx.get(f"{BASE_URL}/poems/random", params={"lang": "zh-Hans"}, timeout=15)
        r.raise_for_status()
        poem = r.json().get("data", {})
        return _fmt_poem(poem)
    except Exception as e:
        return f"获取随机诗词出错: {e}"


@tool
def poetry_get(poem_id: int) -> str:
    """
    Get a specific poem by its ID.
    Args:
        poem_id: the numeric ID of the poem
    """
    import httpx
    try:
        r = httpx.get(f"{BASE_URL}/poems/{poem_id}", params={"lang": "zh-Hans"}, timeout=15)
        r.raise_for_status()
        poem = r.json().get("data", {})
        if not poem or "title" not in poem:
            return f"未找到 ID 为 {poem_id} 的诗词。"
        return _fmt_poem(poem)
    except Exception as e:
        return f"获取诗词出错: {e}"


@tool
def poetry_authors(page: int = 1, page_size: int = 20) -> str:
    """
    List poets/authors with their dynasty info.
    Args:
        page: page number (default 1)
        page_size: results per page (default 20)
    """
    import httpx
    try:
        r = httpx.get(f"{BASE_URL}/authors", params={
            "page": page,
            "page_size": page_size,
            "lang": "zh-Hans",
        }, timeout=15)
        r.raise_for_status()
        data = r.json()
        authors = data.get("data", [])
        pagination = data.get("pagination", {})
        lines = []
        for a in authors:
            name = a.get("name", "?")
            dynasty = a.get("dynasty", {}).get("name", "")
            lines.append(f"{name} ({dynasty})" if dynasty else name)
        has_more = "（还有更多）" if pagination.get("hasMore") else "（已到末尾）"
        return f"诗人列表 (第{page}页):\n" + "\n".join(lines) + f"\n{has_more}"
    except Exception as e:
        return f"获取诗人列表出错: {e}"
