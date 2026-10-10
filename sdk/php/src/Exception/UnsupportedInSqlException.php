<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Exception;

use RuntimeException;

/**
 * Internal: the chosen dialect cannot express this operator (for example a
 * regular expression in SQL Server). Caught by the builder and handed to the
 * `unsupported` policy.
 */
final class UnsupportedInSqlException extends RuntimeException
{
}
