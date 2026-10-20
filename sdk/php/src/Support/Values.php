<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Support;

use DateTimeInterface;

/**
 * Value coercion helpers.
 *
 * Every function here mirrors the behaviour of the JavaScript SDK exactly, so
 * the same document evaluated against the same data returns the same boolean in
 * both runtimes. The shared fixtures in tests/fixtures/cases.json enforce it.
 */
final class Values
{
    public const DAY_MS = 86400000;

    private const TRUE_WORDS = ['1', 'true', 'yes', 'on', 't', 'y'];
    private const FALSE_WORDS = ['0', 'false', 'no', 'off', 'f', 'n', ''];

    /** Sentinel returned when a path is absent from the data set. */
    public const MISSING = "\0kConditionsMissing\0";

    /**
     * Read a value out of the data set, supporting dot paths.
     *
     * @param mixed $data
     * @return mixed The value, or self::MISSING.
     */
    public static function getPath(mixed $data, string $path): mixed
    {
        if ($data === null) {
            return self::MISSING;
        }
        if (is_array($data) && array_key_exists($path, $data)) {
            return $data[$path];
        }
        if (is_object($data) && property_exists($data, $path)) {
            return $data->{$path};
        }
        if (!str_contains($path, '.')) {
            return self::MISSING;
        }

        $cur = $data;
        foreach (explode('.', $path) as $part) {
            if (is_array($cur) && array_key_exists($part, $cur)) {
                $cur = $cur[$part];
            } elseif (is_object($cur) && property_exists($cur, $part)) {
                $cur = $cur->{$part};
            } else {
                return self::MISSING;
            }
        }

        return $cur;
    }

    public static function isMissing(mixed $v): bool
    {
        return is_string($v) && $v === self::MISSING;
    }

    public static function isNullish(mixed $v): bool
    {
        return $v === null || self::isMissing($v);
    }

    public static function isEmptyValue(mixed $v): bool
    {
        if (self::isNullish($v)) {
            return true;
        }
        if (is_string($v)) {
            return $v === '';
        }
        if (is_array($v)) {
            return count($v) === 0;
        }
        if (is_object($v) && !$v instanceof DateTimeInterface) {
            return count(get_object_vars($v)) === 0;
        }

        return false;
    }

    /**
     * Whitespace off both ends exactly as JavaScript's String.prototype.trim() takes it: the ASCII spaces and line breaks,
     * and every Unicode space (a no-break space pasted with a value, U+FEFF) — PHP's trim() keeps those.
     */
    public static function jsTrim(string $s): string
    {
        return (string) preg_replace('/^[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+|[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+$/u', '', $s);
    }

    /** Epoch milliseconds of a UTC wall time, the year taken as written (gmmktime() reads 0–69 as 2000–2069). */
    public static function utcMs(int $y, int $mo, int $d, int $h = 0, int $i = 0, int $s = 0, int $ms = 0): float
    {
        $t = (new \DateTimeImmutable('@0'))->setDate($y, $mo, $d)->setTime($h, $i, $s);

        return (float) $t->getTimestamp() * 1000 + $ms;
    }

    public static function toNumber(mixed $v): ?float
    {
        if (is_int($v) || is_float($v)) {
            return is_finite((float) $v) ? (float) $v : null;
        }
        if (is_bool($v)) {
            return $v ? 1.0 : 0.0;
        }
        if (is_string($v)) {
            $t = self::jsTrim($v);
            if ($t === '' || !is_numeric($t)) {
                return null;
            }
            $n = (float) $t;

            return is_finite($n) ? $n : null;
        }
        if ($v instanceof DateTimeInterface) {
            return (float) ($v->getTimestamp() * 1000);
        }

        return null;
    }

    public static function toBool(mixed $v): ?bool
    {
        if (is_bool($v)) {
            return $v;
        }
        if (is_int($v) || is_float($v)) {
            if ((float) $v === 1.0) {
                return true;
            }

            return (float) $v === 0.0 ? false : null;
        }
        if (self::isNullish($v)) {
            return false;
        }
        if (is_string($v)) {
            $t = strtolower(self::jsTrim($v));
            if (in_array($t, self::TRUE_WORDS, true)) {
                return true;
            }
            if (in_array($t, self::FALSE_WORDS, true)) {
                return false;
            }

            return null;
        }

        return null;
    }

    /**
     * Convert a value to epoch milliseconds, or null when it is not a date.
     *
     * Accepts DateTimeInterface, epoch milliseconds, a bare four-digit year,
     * `YYYY`, `YYYY-MM`, `YYYY-MM-DD` and full ISO 8601 timestamps. Partial
     * dates expand to their earliest instant in UTC.
     */
    public static function toDate(mixed $v): ?float
    {
        if ($v instanceof DateTimeInterface) {
            return (float) $v->getTimestamp() * 1000 + (float) $v->format('v');
        }
        if (is_bool($v) || $v === null) {
            return null;
        }
        if (is_int($v) || is_float($v)) {
            if (!is_finite((float) $v)) {
                return null;
            }
            if ((float) $v >= 1000 && (float) $v <= 9999 && floor((float) $v) === (float) $v) {
                return self::utcMs((int) $v, 1, 1);
            }

            return (float) $v;
        }
        if (!is_string($v)) {
            return null;
        }

        $s = self::jsTrim($v);
        if ($s === '') {
            return null;
        }
        if (preg_match('/^(\d{4})$/', $s, $m)) {
            return self::utcMs((int) $m[1], 1, 1);
        }
        if (preg_match('/^(\d{4})-(\d{1,2})$/', $s, $m)) {
            return self::utcMs((int) $m[1], (int) $m[2], 1);
        }
        if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})$/', $s, $m)) {
            return self::utcMs((int) $m[1], (int) $m[2], (int) $m[3]);
        }
        // A date and time with no zone is a UTC wall time, as a bare date is — whatever the host's default zone.
        if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/', $s, $m)) {
            return self::utcMs((int) $m[1], (int) $m[2], (int) $m[3], (int) $m[4], (int) $m[5], (int) ($m[6] ?? 0), isset($m[7]) && $m[7] !== '' ? (int) substr($m[7] . '00', 0, 3) : 0);
        }
        if (preg_match('/^-?\d+$/', $s)) {
            return self::toDate((int) $s);
        }

        $ts = strtotime($s);

        return $ts === false ? null : (float) $ts * 1000;
    }

    public static function startOfUtcDay(float $ms): float
    {
        return floor($ms / self::DAY_MS) * self::DAY_MS;
    }

    /**
     * Field choices, however they were written, as a list of value/label pairs.
     *
     * Three shapes mean the same thing: a list of scalars, a list of
     * ['value' => …, 'label' => …], or an associative map. Mirrors
     * normaliseChoices() in the JavaScript evaluator — describe() reads labels
     * through this, so the two must agree.
     *
     * @return list<array{value: mixed, label: string}>
     */
    public static function normaliseChoices(mixed $input): array
    {
        if (!is_array($input) || !$input) {
            return [];
        }
        $out = [];
        $isList = array_is_list($input);
        foreach ($input as $key => $c) {
            if (!$isList) {
                $out[] = ['value' => (string) $key, 'label' => $c === null ? (string) $key : (string) $c];
                continue;
            }
            if (is_array($c)) {
                if (!array_key_exists('value', $c)) {
                    continue;
                }
                $out[] = [
                    'value' => $c['value'],
                    'label' => ($c['label'] ?? null) === null ? self::asString($c['value']) : (string) $c['label'],
                ];
                continue;
            }
            $out[] = ['value' => $c, 'label' => self::asString($c)];
        }

        return $out;
    }

    public static function asString(mixed $v): string
    {
        if (self::isNullish($v)) {
            return '';
        }
        if (is_string($v)) {
            return $v;
        }
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if (is_int($v)) {
            return (string) $v;
        }
        if (is_float($v)) {
            return self::numberToString($v);
        }
        if ($v instanceof DateTimeInterface) {
            return $v->format('c');
        }

        return (string) json_encode($v);
    }

    /**
     * A float as text, the same as the JavaScript SDK writes it: its shortest round-trip digits (what JavaScript's
     * String(number) prints) written out in full — never an exponent.
     */
    public static function numberToString(float $v): string
    {
        if (is_nan($v)) {
            return 'NaN';
        }
        if (is_infinite($v)) {
            return $v > 0 ? 'Infinity' : '-Infinity';
        }
        if (floor($v) === $v && abs($v) < 1.0e15) {
            return (string) (int) $v;
        }
        $repr = var_export(abs($v), true);
        if (!preg_match('/^(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i', $repr, $m)) {
            return (string) $v;
        }
        $digits = $m[1] . ($m[2] ?? '');
        $point = strlen($m[1]) + (isset($m[3]) ? (int) $m[3] : 0);
        $lead = strlen($digits) - strlen(ltrim($digits, '0'));
        $digits = rtrim(substr($digits, $lead), '0');
        $point -= $lead;
        if ($digits === '') {
            return '0';
        }
        if ($point <= 0) {
            $out = '0.' . str_repeat('0', -$point) . $digits;
        } elseif ($point >= strlen($digits)) {
            $out = $digits . str_repeat('0', $point - strlen($digits));
        } else {
            $out = substr($digits, 0, $point) . '.' . substr($digits, $point);
        }

        return ($v < 0 ? '-' : '') . $out;
    }

    public static function fold(string $s, bool $caseInsensitive): string
    {
        return $caseInsensitive ? mb_strtolower($s) : $s;
    }

    public static function looseEquals(mixed $a, mixed $b, bool $caseInsensitive = false): bool
    {
        $aNull = self::isNullish($a);
        $bNull = self::isNullish($b);
        if ($aNull && $bNull) {
            return true;
        }
        if ($aNull || $bNull) {
            return false;
        }
        if (is_array($a) || is_array($b)) {
            return json_encode($a) === json_encode($b);
        }
        if (is_bool($a) || is_bool($b)) {
            $ba = self::toBool($a);
            $bb = self::toBool($b);
            if ($ba !== null && $bb !== null) {
                return $ba === $bb;
            }
        }
        $na = self::toNumber($a);
        $nb = self::toNumber($b);
        $aBlank = is_string($a) && self::jsTrim($a) === '';
        $bBlank = is_string($b) && self::jsTrim($b) === '';
        if ($na !== null && $nb !== null && !$aBlank && !$bBlank) {
            return $na === $nb;
        }

        return self::fold(self::asString($a), $caseInsensitive)
            === self::fold(self::asString($b), $caseInsensitive);
    }

    /** @return array<int, mixed> */
    public static function toList(mixed $v): array
    {
        if (is_array($v)) {
            return array_values($v);
        }
        if (self::isNullish($v)) {
            return [];
        }
        if (is_string($v)) {
            $t = self::jsTrim($v);
            if ($t === '') {
                return [];
            }

            return array_map([self::class, 'jsTrim'], explode(',', $t));
        }

        return [$v];
    }

    /** @param array<int, mixed> $list */
    public static function inList(mixed $value, array $list, bool $caseInsensitive = false): bool
    {
        foreach ($list as $candidate) {
            if (self::looseEquals($value, $candidate, $caseInsensitive)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Turn a JavaScript-style bare pattern into a PCRE pattern.
     *
     * Only unescaped forward slashes are escaped, so `^ben` and `a\/b` both
     * survive the round trip.
     */
    public static function toPcre(string $pattern, bool $caseInsensitive = false): string
    {
        $escaped = preg_replace('~(?<!\\\\)/~', '\\/', $pattern) ?? $pattern;

        return '/' . $escaped . '/' . ($caseInsensitive ? 'i' : '');
    }

    public static function regexTest(string $pattern, string $subject, bool $caseInsensitive = false): bool
    {
        $compiled = self::toPcre($pattern, $caseInsensitive);
        $result = @preg_match($compiled, $subject);
        if ($result === false) {
            throw new \RuntimeException(sprintf('Invalid regular expression: %s', $pattern));
        }

        return $result === 1;
    }
}
