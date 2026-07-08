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
