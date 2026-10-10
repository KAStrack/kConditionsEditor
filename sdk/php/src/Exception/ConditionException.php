<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Exception;

use RuntimeException;
use Throwable;

/**
 * Raised when evaluation cannot continue: a malformed document, or an operator
 * that failed under an `error` policy.
 */
class ConditionException extends RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(string $message, public readonly array $details = [], ?Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
