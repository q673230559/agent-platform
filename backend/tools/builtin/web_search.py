from langchain.tools import tool


@tool
def web_search(query: str) -> str:
    """
    Search the web using DuckDuckGo for up-to-date information.
    Args:
        query: the search query string
    """
    try:
        from duckduckgo_search import DDGS
        results = DDGS().text(query, max_results=5)
        if not results:
            return "No results found."
        lines = []
        for r in results:
            lines.append(f"- {r['title']}: {r['href']}\n  {r.get('body', '')}")
        return "\n\n".join(lines)
    except ImportError:
        return "web_search unavailable: duckduckgo-search package not installed"
    except Exception as e:
        return f"Search error: {e}"
