"""Retry utilities for handling transient API errors (429 rate limit, 503, etc.)."""

import asyncio
import logging
import random
from typing import Awaitable, Callable, Optional, TypeVar

logger = logging.getLogger("retry")

T = TypeVar("T")

# Patterns in error messages that indicate a retryable error
RETRYABLE_PATTERNS = [
    "429",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    "503",
    "service unavailable",
    "service_unavailable",
    "connection reset",
    "connectionreset",
    "read timeout",
    "readtimeout",
    "timed out",
    "timedout",
]


def is_rate_limit_error(exception: Exception) -> bool:
    """Check if an exception is a 429 rate limit error."""
    error_str = str(exception).lower()

    if hasattr(exception, "status_code") and exception.status_code == 429:
        return True

    if hasattr(exception, "response"):
        resp = exception.response
        if hasattr(resp, "status_code") and resp.status_code == 429:
            return True

    if "429" in error_str or "rate limit" in error_str or "rate_limit" in error_str:
        return True

    return False


def is_retryable_error(exception: Exception) -> bool:
    """Check if an exception represents a transient error worth retrying."""
    if is_rate_limit_error(exception):
        return True

    if hasattr(exception, "status_code"):
        code = exception.status_code
        if code in (429, 503, 502, 504):
            return True

    if hasattr(exception, "response"):
        resp = exception.response
        if hasattr(resp, "status_code") and resp.status_code in (429, 503, 502, 504):
            return True

    error_str = str(exception).lower()
    for pattern in RETRYABLE_PATTERNS:
        if pattern in error_str:
            return True

    return False


def _backoff_delay(attempt: int, base_delay: float, max_delay: float, backoff_factor: float, jitter: bool) -> float:
    """Calculate backoff delay for a given retry attempt."""
    delay = min(base_delay * (backoff_factor ** attempt), max_delay)
    if jitter:
        delay = delay * (0.5 + random.random())
    return delay


async def async_retry_with_backoff(
    fn: Callable[..., Awaitable[T]],
    *args,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    backoff_factor: float = 2.0,
    jitter: bool = True,
    on_retry: Optional[Callable[[int, int, float, Exception], None]] = None,
    **kwargs,
) -> T:
    """Execute an async function with exponential backoff retry on transient errors.

    Args:
        fn: Async callable to execute.
        max_retries: Maximum number of retry attempts (0 = no retry).
        base_delay: Initial backoff delay in seconds.
        max_delay: Maximum backoff delay in seconds.
        backoff_factor: Multiplier for each successive backoff.
        jitter: If True, add ±50% random jitter to the delay.
        on_retry: Optional callback(attempt, max_retries, delay_seconds, exception)
                  called before each retry.

    Returns:
        The return value of fn.

    Raises:
        The last exception if all retries are exhausted or the error is not retryable.
    """
    last_exception: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        try:
            return await fn(*args, **kwargs)
        except Exception as e:
            last_exception = e

            if attempt >= max_retries or not is_retryable_error(e):
                raise

            delay = _backoff_delay(attempt, base_delay, max_delay, backoff_factor, jitter)

            logger.warning(
                f"Transient error, retrying in {delay:.1f}s "
                f"(attempt {attempt + 1}/{max_retries}): {e}"
            )

            if on_retry:
                on_retry(attempt + 1, max_retries, delay, e)

            await asyncio.sleep(delay)

    raise last_exception  # type: ignore[misc]
