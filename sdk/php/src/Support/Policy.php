<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Support;

/**
 * Resolves a policy value against the evaluator's context labels.
 *
 * A policy value is either a bare name ("skip") or a map keyed by context label
 * ({"client": "skip", "server": "error", "*": "error"}). Labels are tried in the
 * order supplied, then "*", then "default".
 */
final class Policy
{
    public const SKIP = 'skip';
    public const TRUE = 'true';
    public const FALSE = 'false';
    public const ERROR = 'error';

    public const NAMES = [self::SKIP, self::TRUE, self::FALSE, self::ERROR];

    /**
     * @param mixed $policyValue
     * @param array<int, string> $labels
     */
    public static function resolve(mixed $policyValue, array $labels): ?string
    {
        if ($policyValue === null) {
            return null;
        }
        if (is_string($policyValue)) {
            return in_array($policyValue, self::NAMES, true) ? $policyValue : null;
        }
        if (!is_array($policyValue)) {
            return null;
        }
        foreach ($labels as $label) {
            if (isset($policyValue[$label]) && in_array($policyValue[$label], self::NAMES, true)) {
                return $policyValue[$label];
            }
        }
        foreach (['*', 'default'] as $fallback) {
            if (isset($policyValue[$fallback]) && in_array($policyValue[$fallback], self::NAMES, true)) {
                return $policyValue[$fallback];
            }
        }

        return null;
    }
}
