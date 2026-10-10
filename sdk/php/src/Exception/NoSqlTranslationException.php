<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Exception;

use RuntimeException;

/**
 * Internal: the operator has no SQL translation at all — an unknown operator,
 * or a callback operator with no `sql` template. Caught by the builder and
 * handed to the `unresolved` policy.
 */
final class NoSqlTranslationException extends RuntimeException
{
}
