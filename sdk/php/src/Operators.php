<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor;

use Kastrack\ConditionsEditor\Support\Values;

/**
 * The builtin operator library.
 *
 * Each operator is a callable(mixed $fieldValue, array $args, array $ctx): bool.
 * $ctx carries at least `now` (epoch ms) and `caseInsensitive`.
 */
final class Operators
{
    /** @var array<string, array{group: string, label: string, arity: int|string, valueKind: string}>|null */
    private static ?array $meta = null;

    /** @var array<string, callable>|null */
    private static ?array $impl = null;

    /** @return array<string, array{group: string, label: string, arity: int|string, valueKind: string}> */
    public static function meta(): array
    {
        self::boot();

        return self::$meta;
    }

    /** @return array<string, callable> */
    public static function all(): array
    {
        self::boot();

        return self::$impl;
    }

    public static function has(string $name): bool
    {
        self::boot();

        return isset(self::$impl[$name]);
    }

    public static function get(string $name): ?callable
    {
        self::boot();

        return self::$impl[$name] ?? null;
    }

    /** @return int|string 0, 1, 2 or 'n' */
    public static function arity(string $name): int|string
    {
        self::boot();

        return self::$meta[$name]['arity'] ?? 1;
    }

    private static function boot(): void
    {
        if (self::$impl !== null) {
            return;
        }

        $ci = static fn (array $ctx): bool => (bool) ($ctx['caseInsensitive'] ?? false);
        $str = static fn (mixed $v, array $ctx): string => Values::fold(Values::asString($v), (bool) ($ctx['caseInsensitive'] ?? false));

        $num = static function (mixed $a, mixed $b, callable $cmp): bool {
            $na = Values::toNumber($a);
            $nb = Values::toNumber($b);

            return $na !== null && $nb !== null && $cmp($na, $nb);
        };

        $date = static function (mixed $a, mixed $b, callable $cmp): bool {
            $da = Values::toDate($a);
            $db = Values::toDate($b);

            return $da !== null && $db !== null && $cmp($da, $db);
        };

        self::$impl = [
            /* equality */
            'eq' => static fn ($v, $a, $c) => Values::looseEquals($v, $a[0] ?? null, $ci($c)),
            'neq' => static fn ($v, $a, $c) => !Values::looseEquals($v, $a[0] ?? null, $ci($c)),

            /* arithmetic */
            'lt' => static fn ($v, $a) => $num($v, $a[0] ?? null, static fn ($x, $y) => $x < $y),
            'lte' => static fn ($v, $a) => $num($v, $a[0] ?? null, static fn ($x, $y) => $x <= $y),
            'gt' => static fn ($v, $a) => $num($v, $a[0] ?? null, static fn ($x, $y) => $x > $y),
            'gte' => static fn ($v, $a) => $num($v, $a[0] ?? null, static fn ($x, $y) => $x >= $y),
            'between' => static function ($v, $a) {
                $n = Values::toNumber($v);
                $lo = Values::toNumber($a[0] ?? null);
                $hi = Values::toNumber($a[1] ?? null);
                if ($n === null || $lo === null || $hi === null) {
                    return false;
                }
                if ($lo > $hi) {
                    [$lo, $hi] = [$hi, $lo];
                }

                return $n >= $lo && $n <= $hi;
            },
            'not_between' => static function ($v, $a) {
                $n = Values::toNumber($v);
                $lo = Values::toNumber($a[0] ?? null);
                $hi = Values::toNumber($a[1] ?? null);
                if ($n === null || $lo === null || $hi === null) {
                    return false;
                }
                if ($lo > $hi) {
                    [$lo, $hi] = [$hi, $lo];
                }

                return $n < $lo || $n > $hi;
            },

            /* alphanumeric */
            'contains' => static fn ($v, $a, $c) => $str($a[0] ?? null, $c) === ''
                ? true
                : str_contains($str($v, $c), $str($a[0] ?? null, $c)),
            'not_contains' => static fn ($v, $a, $c) => $str($a[0] ?? null, $c) === ''
                ? false
                : !str_contains($str($v, $c), $str($a[0] ?? null, $c)),
            'starts_with' => static fn ($v, $a, $c) => str_starts_with($str($v, $c), $str($a[0] ?? null, $c)),
            'ends_with' => static fn ($v, $a, $c) => str_ends_with($str($v, $c), $str($a[0] ?? null, $c)),
            'regex' => static fn ($v, $a, $c) => Values::regexTest(
                Values::asString($a[0] ?? null),
                Values::asString($v),
                $ci($c)
            ),
            'not_regex' => static fn ($v, $a, $c) => !Values::regexTest(
                Values::asString($a[0] ?? null),
                Values::asString($v),
                $ci($c)
            ),
            'in_list' => static fn ($v, $a, $c) => Values::inList($v, Values::toList($a[0] ?? null), $ci($c)),
            'not_in_list' => static fn ($v, $a, $c) => !Values::inList($v, Values::toList($a[0] ?? null), $ci($c)),

            /* date */
            'date_eq' => static fn ($v, $a) => $date(
                $v,
                $a[0] ?? null,
                static fn ($x, $y) => Values::startOfUtcDay($x) === Values::startOfUtcDay($y)
            ),
            'date_before' => static fn ($v, $a) => $date($v, $a[0] ?? null, static fn ($x, $y) => $x < $y),
            'date_after' => static fn ($v, $a) => $date($v, $a[0] ?? null, static fn ($x, $y) => $x > $y),
            'date_between' => static function ($v, $a) {
                $d = Values::toDate($v);
                $lo = Values::toDate($a[0] ?? null);
                $hi = Values::toDate($a[1] ?? null);
                if ($d === null || $lo === null || $hi === null) {
                    return false;
                }
                if ($lo > $hi) {
                    [$lo, $hi] = [$hi, $lo];
                }

                return $d >= $lo && $d <= $hi;
            },
            'date_is_today' => static function ($v, $a, $c) {
                $d = Values::toDate($v);

                return $d !== null && Values::startOfUtcDay($d) === Values::startOfUtcDay((float) $c['now']);
            },
            'date_within_last_days' => static function ($v, $a, $c) {
                $d = Values::toDate($v);
                $n = Values::toNumber($a[0] ?? null);
                if ($d === null || $n === null) {
                    return false;
                }

                return $d >= $c['now'] - $n * Values::DAY_MS && $d <= $c['now'];
            },
            'date_within_next_days' => static function ($v, $a, $c) {
                $d = Values::toDate($v);
                $n = Values::toNumber($a[0] ?? null);
                if ($d === null || $n === null) {
                    return false;
                }

                return $d >= $c['now'] && $d <= $c['now'] + $n * Values::DAY_MS;
            },
            'date_more_than_days_ago' => static function ($v, $a, $c) {
                $d = Values::toDate($v);
                $n = Values::toNumber($a[0] ?? null);
                if ($d === null || $n === null) {
                    return false;
                }

                return $d < $c['now'] - $n * Values::DAY_MS;
            },
            'date_more_than_days_ahead' => static function ($v, $a, $c) {
                $d = Values::toDate($v);
                $n = Values::toNumber($a[0] ?? null);
                if ($d === null || $n === null) {
                    return false;
                }

                return $d > $c['now'] + $n * Values::DAY_MS;
            },

            /* boolean */
            'is_true' => static fn ($v) => Values::toBool($v) === true,
            'is_false' => static fn ($v) => Values::toBool($v) === false,

            /* existence */
            'is_set' => static fn ($v) => !Values::isNullish($v),
            'is_not_set' => static fn ($v) => Values::isNullish($v),
            'is_empty' => static fn ($v) => Values::isEmptyValue($v),
            'is_not_empty' => static fn ($v) => !Values::isEmptyValue($v),
        ];

        // `valueFromChoices` says whether the operand is drawn from the field's
        // own value set. False for the operators whose operand is a fragment or
        // a pattern, so describe() does not swap a substring for a choice label
        // and render `contains "FL"` as `contains "Florida"`. Absent means true.
        self::$meta = [
            'eq' => ['group' => 'equality', 'label' => 'is equal to', 'arity' => 1, 'valueKind' => 'text'],
            'neq' => ['group' => 'equality', 'label' => 'is not equal to', 'arity' => 1, 'valueKind' => 'text'],
            'lt' => ['group' => 'arithmetic', 'label' => 'is less than', 'arity' => 1, 'valueKind' => 'number'],
            'lte' => ['group' => 'arithmetic', 'label' => 'is at most', 'arity' => 1, 'valueKind' => 'number'],
            'gt' => ['group' => 'arithmetic', 'label' => 'is greater than', 'arity' => 1, 'valueKind' => 'number'],
            'gte' => ['group' => 'arithmetic', 'label' => 'is at least', 'arity' => 1, 'valueKind' => 'number'],
            'between' => ['group' => 'arithmetic', 'label' => 'is between', 'arity' => 2, 'valueKind' => 'number'],
            'not_between' => ['group' => 'arithmetic', 'label' => 'is not between', 'arity' => 2, 'valueKind' => 'number'],
            'contains' => ['group' => 'alphanumeric', 'label' => 'contains', 'arity' => 1, 'valueKind' => 'text', 'valueFromChoices' => false],
            'not_contains' => ['group' => 'alphanumeric', 'label' => 'does not contain', 'arity' => 1, 'valueKind' => 'text', 'valueFromChoices' => false],
            'starts_with' => ['group' => 'alphanumeric', 'label' => 'starts with', 'arity' => 1, 'valueKind' => 'text', 'valueFromChoices' => false],
            'ends_with' => ['group' => 'alphanumeric', 'label' => 'ends with', 'arity' => 1, 'valueKind' => 'text', 'valueFromChoices' => false],
            'regex' => ['group' => 'alphanumeric', 'label' => 'matches regex', 'arity' => 1, 'valueKind' => 'text', 'valueFromChoices' => false],
            'not_regex' => ['group' => 'alphanumeric', 'label' => 'does not match regex', 'arity' => 1, 'valueKind' => 'text', 'valueFromChoices' => false],
            'in_list' => ['group' => 'alphanumeric', 'label' => 'is one of', 'arity' => 'n', 'valueKind' => 'list'],
            'not_in_list' => ['group' => 'alphanumeric', 'label' => 'is not one of', 'arity' => 'n', 'valueKind' => 'list'],
            'date_eq' => ['group' => 'date', 'label' => 'is on', 'arity' => 1, 'valueKind' => 'date'],
            'date_before' => ['group' => 'date', 'label' => 'is before', 'arity' => 1, 'valueKind' => 'date'],
            'date_after' => ['group' => 'date', 'label' => 'is after', 'arity' => 1, 'valueKind' => 'date'],
            'date_between' => ['group' => 'date', 'label' => 'is between', 'arity' => 2, 'valueKind' => 'date'],
            'date_is_today' => ['group' => 'date', 'label' => 'is today', 'arity' => 0, 'valueKind' => 'none'],
            'date_within_last_days' => ['group' => 'date', 'label' => 'is within the last N days', 'arity' => 1, 'valueKind' => 'number'],
            'date_within_next_days' => ['group' => 'date', 'label' => 'is within the next N days', 'arity' => 1, 'valueKind' => 'number'],
            'date_more_than_days_ago' => ['group' => 'date', 'label' => 'is more than N days ago', 'arity' => 1, 'valueKind' => 'number'],
            'date_more_than_days_ahead' => ['group' => 'date', 'label' => 'is more than N days from now', 'arity' => 1, 'valueKind' => 'number'],
            'is_true' => ['group' => 'boolean', 'label' => 'is true', 'arity' => 0, 'valueKind' => 'none'],
            'is_false' => ['group' => 'boolean', 'label' => 'is false', 'arity' => 0, 'valueKind' => 'none'],
            'is_set' => ['group' => 'existence', 'label' => 'is set', 'arity' => 0, 'valueKind' => 'none'],
            'is_not_set' => ['group' => 'existence', 'label' => 'is not set', 'arity' => 0, 'valueKind' => 'none'],
            'is_empty' => ['group' => 'existence', 'label' => 'is empty', 'arity' => 0, 'valueKind' => 'none'],
            'is_not_empty' => ['group' => 'existence', 'label' => 'is not empty', 'arity' => 0, 'valueKind' => 'none'],
        ];
    }
}
