<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Support;

/**
 * Label templates.
 *
 * A label may carry placeholders — `{name}` — so a translation can put a value
 * where its own word order wants it: 'Remove {value}' in English, 'Ta bort
 * {value}' in Swedish, '删除{value}' in Chinese. Mirrors the JavaScript SDK's
 * helpers of the same names; the shared describe fixtures hold both to it.
 */
final class Labels
{
    public const VALUE_SLOT = '{value}';

    /**
     * Fill `{name}` placeholders from $vars; one with no value is left as written.
     *
     * @param array<string, mixed> $vars
     */
    public static function fillTemplate(string $template, array $vars = []): string
    {
        return (string) preg_replace_callback(
            '/\{([A-Za-z][A-Za-z0-9]*)\}/',
            static function (array $m) use ($vars): string {
                if (!array_key_exists($m[1], $vars) || $vars[$m[1]] === null) {
                    return $m[0];
                }
                $v = $vars[$m[1]];

                return is_scalar($v) ? (is_bool($v) ? ($v ? 'true' : 'false') : (string) $v) : $m[0];
            },
            $template
        );
    }

    /**
     * Split an operator label at its `{value}` slot, or null when it has none.
     *
     * The whitespace either side of the slot is kept as written: '在过去{value}天内'
     * wants none. A second `{value}` means nothing and is dropped.
     *
     * @return array{head: string, before: string, after: string, tail: string}|null
     */
    public static function splitOperatorLabel(string $label): ?array
    {
        $at = strpos($label, self::VALUE_SLOT);
        if ($at === false) {
            return null;
        }
        $head = substr($label, 0, $at);
        $tail = str_replace(self::VALUE_SLOT, '', substr($label, $at + strlen(self::VALUE_SLOT)));
        // \s in JavaScript covers Unicode spaces; with /u, so does PCRE's.
        $h = (string) preg_replace('/\s+$/u', '', $head);
        $t = (string) preg_replace('/^\s+/u', '', $tail);

        return [
            'head' => $h,
            'before' => substr($head, strlen($h)),
            'after' => substr($tail, 0, strlen($tail) - strlen($t)),
            'tail' => $t,
        ];
    }

    /** An operator label as a whole, with an ellipsis where the operand goes. */
    public static function operatorLabelText(string $label, string $gap = '…'): string
    {
        $slot = self::splitOperatorLabel($label);
        if ($slot === null) {
            return $label;
        }

        return (string) preg_replace('/^\s+|\s+$/u', '', $slot['head'] . $slot['before'] . $gap . $slot['after'] . $slot['tail']);
    }

    /**
     * A non-empty string from a labels map, or the fallback.
     *
     * @param array<string, mixed> $map
     */
    public static function labelOr(array $map, string $key, ?string $fallback): ?string
    {
        $v = $map[$key] ?? null;

        return is_string($v) && $v !== '' ? $v : $fallback;
    }
}
