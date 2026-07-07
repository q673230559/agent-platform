from langchain.tools import tool


@tool
def calculator(a: float, b: float, op: str) -> float:
    """
    Perform arithmetic operations: add, sub, mul, div.
    Args:
        a: first number
        b: second number
        op: operation type, one of add / sub / mul / div
    """
    match op:
        case "add":
            return a + b
        case "sub":
            return a - b
        case "mul":
            return a * b
        case "div":
            if b == 0:
                raise ValueError("Cannot divide by zero")
            return a / b
        case _:
            raise ValueError(f"Unsupported operation: {op}, must be add/sub/mul/div")


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
