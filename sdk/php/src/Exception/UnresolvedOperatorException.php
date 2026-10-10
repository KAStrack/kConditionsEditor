<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Exception;

/**
 * Raised when an operator cannot be resolved in this runtime and the governing
 * unresolved policy is `error`.
 */
final class UnresolvedOperatorException extends ConditionException
{
}
