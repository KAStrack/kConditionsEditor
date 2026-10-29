<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor;

use Kastrack\ConditionsEditor\Exception\ConditionException;
use Kastrack\ConditionsEditor\Exception\UnresolvedOperatorException;
use Kastrack\ConditionsEditor\Support\Labels;
use Kastrack\ConditionsEditor\Support\Policy;
use Kastrack\ConditionsEditor\Support\Values;
use Throwable;

/**
 * Evaluates kConditions documents (spec version 1.0).
 *
 * @phpstan-type Options array{
 *   runtime?: string,
 *   environment?: string|null,
 *   profiles?: array<int, string>,
 *   unresolvedPolicy?: string|array<string, string>,
 *   errorPolicy?: string|array<string, string>,
 *   emptyResult?: bool,
 *   caseInsensitive?: bool,
 *   now?: int|float|string|\DateTimeInterface|callable|null,
 *   callbacks?: array<string, callable>,
 *   allowManifestCallbacks?: bool,
 *   callbackAllowList?: array<int, string>|null,
 *   container?: object|null,
 *   trace?: bool
 * }
 */
final class Evaluator
{
    public const SPEC_VERSION = '1.0';
    public const VERSION = '0.1.3';

    /** @var array<string, mixed> */
    private array $options;

    /** @var array<string, callable> */
    private array $registry = [];

    /**
     * The English for each problem validateDocument() can report, keyed by its
     * `code`. `{name}` is filled from the problem's `params`. The same keys and
     * placeholders as the JavaScript SDK's PROBLEM_MESSAGES and the editor's
     * `labels.problems`.
     */
    public const PROBLEM_MESSAGES = [
        'notObject' => 'Node is not an object',
        'groupOperator' => 'Group operator must be "and" or "or"',
        'groupChildren' => 'Group children must be an array',
        'nodeType' => 'Unknown node type "{type}"',
        'noField' => 'Condition has no field',
        'unknownField' => 'Unknown field "{field}"',
        'unknownOperator' => 'Unknown operator "{operator}"',
        'listArity' => 'Operator "{operator}" expects a single list value',
        'arity' => 'Operator "{operator}" expects {expected} value(s), got {actual}',
        'valueNotObject' => 'Value must be an object',
        'valueNoField' => 'Field value has no field name',
        'valueSource' => 'Value source must be "literal" or "field"',
    ];

    /** @var array<string, mixed> */
    private const DEFAULTS = [
        'runtime' => 'php',
        'environment' => null,
        'profiles' => [],
        'unresolvedPolicy' => Policy::ERROR,
        'errorPolicy' => Policy::ERROR,
        'emptyResult' => true,
        'caseInsensitive' => false,
        'now' => null,
        'callbacks' => [],
        'allowManifestCallbacks' => false,
        'callbackAllowList' => null,
        'container' => null,
        'trace' => false,
    ];

    /** @param array<string, mixed> $options */
    public function __construct(array $options = [])
    {
        $this->options = array_merge(self::DEFAULTS, $options);
        foreach ((array) ($this->options['callbacks'] ?? []) as $name => $fn) {
            if (is_callable($fn)) {
                $this->registry[(string) $name] = $fn;
            }
        }
    }

    /** @return array<string, mixed> */
    public function options(): array
    {
        return $this->options;
    }

    public function registerOperator(string $name, callable $fn): self
    {
        $this->registry[$name] = $fn;

        return $this;
    }

    /** @param array<string, callable> $map */
    public function registerOperators(array $map): self
    {
        foreach ($map as $name => $fn) {
            $this->registerOperator((string) $name, $fn);
        }

        return $this;
    }

    /** @return array<int, string> */
    public function contextLabels(): array
    {
        $labels = [];
        foreach ((array) ($this->options['profiles'] ?? []) as $p) {
            if ($p !== null && $p !== '') {
                $labels[] = (string) $p;
            }
        }
        if (!empty($this->options['environment'])) {
            $labels[] = (string) $this->options['environment'];
        }
        if (!empty($this->options['runtime'])) {
            $labels[] = (string) $this->options['runtime'];
        }

        return $labels;
    }

    public function nowMs(): float
    {
        $n = $this->options['now'] ?? null;
        if (is_callable($n)) {
            $n = $n();
        }
        if ($n instanceof \DateTimeInterface) {
            return (float) $n->getTimestamp() * 1000;
        }
        if (is_int($n) || is_float($n)) {
            return (float) $n;
        }
        if (is_string($n) && $n !== '') {
            $d = Values::toDate($n);
            if ($d !== null) {
                return $d;
            }
        }

        return floor(microtime(true) * 1000);
    }

    /**
     * Evaluate a document and return a boolean, or the return value of $hook.
     *
     * @param array<string, mixed>|string $document
     * @param array<string, mixed>|object $data
     * @param callable|null $hook fn($document, $data, $options, bool $result, EvaluationResult $details): mixed
     */
    public function evaluate(array|string $document, array|object $data = [], ?callable $hook = null): mixed
    {
        $details = $this->evaluateDetailed($document, $data);
        if ($hook !== null) {
            return $hook($document, $data, $this->options, $details->result, $details);
        }

        return $details->result;
    }

    /**
     * @param array<string, mixed>|string $document
     * @param array<string, mixed>|object $data
     */
    public function evaluateDetailed(array|string $document, array|object $data = []): EvaluationResult
    {
        $doc = self::normaliseDocument($document);
        $state = [
            'doc' => $doc,
            'data' => $data,
            'labels' => $this->contextLabels(),
            'now' => $this->nowMs(),
            'skipped' => [],
            'errors' => [],
            'trace' => $this->options['trace'] ? [] : null,
        ];

        $outcome = $this->evalNode($doc['root'], $state, 'root');
        $result = Skip::is($outcome) ? (bool) $this->options['emptyResult'] : (bool) $outcome;

        return new EvaluationResult(
            $result,
            $state['skipped'],
            $state['errors'],
            $state['trace'],
            Skip::is($outcome),
        );
    }

    /** @param array<string, mixed> $state */
    private function evalNode(mixed $node, array &$state, string $path): bool|Skip
    {
        if (!is_array($node)) {
            return Skip::instance();
        }
        $type = $node['type'] ?? null;
        if ($type === 'group') {
            return $this->evalGroup($node, $state, $path);
        }
        if ($type === 'condition') {
            return $this->evalCondition($node, $state, $path);
        }

        throw new ConditionException(sprintf('Unknown node type "%s" at %s', (string) $type, $path), ['path' => $path]);
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, mixed> $state
     */
    private function evalGroup(array $node, array &$state, string $path): bool|Skip
    {
        $children = is_array($node['children'] ?? null) ? $node['children'] : [];
        $isAnd = ($node['operator'] ?? 'and') !== 'or';
        $kept = 0;
        $acc = $isAnd;

        foreach ($children as $i => $child) {
            $r = $this->evalNode($child, $state, $path . '.children[' . $i . ']');
            if (Skip::is($r)) {
                continue;
            }
            $kept++;
            if ($isAnd) {
                $acc = $acc && $r;
            } else {
                $acc = $kept === 1 ? $r : ($acc || $r);
            }
        }

        if ($kept === 0) {
            return Skip::instance();
        }

        $out = !empty($node['negate']) ? !$acc : (bool) $acc;
        if ($state['trace'] !== null) {
            $state['trace'][] = ['path' => $path, 'type' => 'group', 'operator' => $isAnd ? 'and' : 'or', 'result' => $out, 'evaluated' => $kept];
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, mixed> $state
     */
    private function evalCondition(array $node, array &$state, string $path): bool|Skip
    {
        $name = (string) ($node['operator'] ?? '');
        $manifest = $state['doc']['operators'][$name] ?? null;
        $labels = $state['labels'];

        $policyFor = function (string $kind) use ($node, $manifest, $labels): string {
            $chosen = null;
            if (isset($node['policy'][$kind])) {
                $chosen = Policy::resolve($node['policy'][$kind], $labels);
            }
            if ($chosen === null && isset($manifest['policy'][$kind])) {
                $chosen = Policy::resolve($manifest['policy'][$kind], $labels);
            }
            if ($chosen === null) {
                $fallback = $kind === 'unresolved' ? $this->options['unresolvedPolicy'] : $this->options['errorPolicy'];
                $chosen = Policy::resolve($fallback, $labels);
            }

            return $chosen ?? Policy::ERROR;
        };

        $applyPolicy = function (string $policy, string $reason, ?Throwable $cause) use (&$state, $node, $name, $path): bool|Skip {
            if ($policy === Policy::SKIP) {
                $state['skipped'][] = ['path' => $path, 'field' => $node['field'] ?? null, 'operator' => $name, 'reason' => $reason];

                return Skip::instance();
            }
            if ($policy === Policy::TRUE || $policy === Policy::FALSE) {
                $state['errors'][] = [
                    'path' => $path,
                    'operator' => $name,
                    'reason' => $reason,
                    'handled' => $policy,
                    'message' => $cause?->getMessage(),
                ];

                return $policy === Policy::TRUE;
            }
            if ($reason === 'unresolved' || $reason === 'unavailable') {
                throw new UnresolvedOperatorException(
                    sprintf(
                        'Operator "%s" could not be resolved at %s%s',
                        $name,
                        $path,
                        $reason === 'unavailable' ? ' (not available in this context)' : ''
                    ),
                    ['path' => $path, 'operator' => $name, 'reason' => $reason],
                    $cause
                );
            }

            throw new ConditionException(
                sprintf('Error evaluating operator "%s" at %s: %s', $name, $path, $cause?->getMessage() ?? 'unknown error'),
                ['path' => $path, 'operator' => $name],
                $cause
            );
        };

        /* availability gate */
        if (is_array($manifest) && !empty($manifest['availableIn']) && is_array($manifest['availableIn'])) {
            if (count(array_intersect($labels, $manifest['availableIn'])) === 0) {
                return $applyPolicy($policyFor('unresolved'), 'unavailable', null);
            }
        }

        /* resolve the implementation */
        $impl = null;
        if (isset($this->registry[$name])) {
            $impl = $this->registry[$name];
        } elseif ($manifest === null && Operators::has($name)) {
            $impl = Operators::get($name);
        } elseif (is_array($manifest) && ($manifest['kind'] ?? null) === 'values') {
            $impl = self::makeValuesOperator($manifest);
        } elseif (is_array($manifest) && ($manifest['kind'] ?? null) === 'callback') {
            try {
                $impl = $this->resolveManifestCallback($name, $manifest);
            } catch (Throwable $e) {
                return $applyPolicy($policyFor('unresolved'), 'unresolved', $e);
            }
        } elseif (Operators::has($name)) {
            $impl = Operators::get($name);
        }

        if ($impl === null) {
            return $applyPolicy($policyFor('unresolved'), 'unresolved', null);
        }

        /* resolve operands and run */
        try {
            $fieldValue = Values::getPath($state['data'], (string) ($node['field'] ?? ''));
            $args = [];
            foreach (($node['values'] ?? []) as $v) {
                $args[] = self::resolveValue($v, $state);
            }
            $ctx = [
                'field' => $node['field'] ?? null,
                'operator' => $name,
                'manifest' => $manifest,
                'data' => $state['data'],
                'document' => $state['doc'],
                'now' => $state['now'],
                'runtime' => $this->options['runtime'],
                'environment' => $this->options['environment'],
                'profiles' => $this->options['profiles'],
                'labels' => $labels,
                'caseInsensitive' => (bool) $this->options['caseInsensitive'],
                'path' => $path,
            ];
            $raw = $impl(Values::isMissing($fieldValue) ? null : $fieldValue, $args, $ctx);
            if (Skip::is($raw)) {
                $state['skipped'][] = ['path' => $path, 'field' => $node['field'] ?? null, 'operator' => $name, 'reason' => 'callback-skip'];

                return Skip::instance();
            }
            $out = (bool) $raw;
        } catch (UnresolvedOperatorException $e) {
            throw $e;
        } catch (Throwable $e) {
            return $applyPolicy($policyFor('error'), 'error', $e);
        }

        $final = !empty($node['negate']) ? !$out : $out;
        if ($state['trace'] !== null) {
            $state['trace'][] = ['path' => $path, 'type' => 'condition', 'field' => $node['field'] ?? null, 'operator' => $name, 'result' => $final];
        }

        return $final;
    }

    /**
     * Resolve a callback described by the document manifest.
     *
     * Disabled unless `allowManifestCallbacks` is true, because dispatching on a
     * function name taken from a JSON document is arbitrary code execution.
     * Prefer registerOperator().
     *
     * @param array<string, mixed> $manifest
     */
    private function resolveManifestCallback(string $name, array $manifest): ?callable
    {
        if (empty($this->options['allowManifestCallbacks'])) {
            return null;
        }
        $allow = $this->options['callbackAllowList'];
        if (is_array($allow) && !in_array($name, $allow, true)) {
            return null;
        }

        $runtime = (string) $this->options['runtime'];
        $binding = $manifest['callbacks'][$runtime] ?? $manifest['callbacks']['php'] ?? null;
        if (!is_array($binding)) {
            return null;
        }

        $class = $binding['class'] ?? null;
        $method = $binding['method'] ?? $binding['function'] ?? null;

        if ($class !== null && $method !== null) {
            $class = ltrim((string) $class, '\\');
            if (!class_exists($class)) {
                return null;
            }
            $isStatic = (bool) ($binding['static'] ?? true);
            if ($isStatic) {
                return is_callable([$class, (string) $method]) ? [$class, (string) $method] : null;
            }
            $container = $this->options['container'] ?? null;
            $instance = null;
            if (is_object($container) && method_exists($container, 'get')) {
                $instance = $container->get($class);
            } elseif (((new \ReflectionClass($class))->getConstructor()?->getNumberOfRequiredParameters() ?? 0) === 0) {
                $instance = new $class();
            }

            return is_object($instance) && is_callable([$instance, (string) $method]) ? [$instance, (string) $method] : null;
        }

        $fn = $binding['function'] ?? null;
        if (is_string($fn) && $fn !== '') {
            $fn = ltrim($fn, '\\');

            return function_exists($fn) ? $fn : null;
        }

        return null;
    }

    /** @param array<string, mixed> $manifest */
    private static function makeValuesOperator(array $manifest): callable
    {
        $list = is_array($manifest['values'] ?? null) ? $manifest['values'] : [];
        $negated = ($manifest['match'] ?? 'in') === 'not_in';
        $arity = $manifest['arity'] ?? 0;

        return static function (mixed $value, array $args, array $ctx) use ($list, $negated, $arity): bool {
            $haystack = $list;
            if ($arity !== 0 && count($args) > 0) {
                $haystack = Values::toList($args[0]);
            }
            $hit = Values::inList($value, $haystack, (bool) ($ctx['caseInsensitive'] ?? false));

            return $negated ? !$hit : $hit;
        };
    }

    /** @param array<string, mixed> $state */
    private static function resolveValue(mixed $node, array $state): mixed
    {
        if (!is_array($node)) {
            return $node;
        }
        if (($node['source'] ?? null) === 'field') {
            $v = Values::getPath($state['data'], (string) ($node['field'] ?? ''));

            return Values::isMissing($v) ? null : $v;
        }

        return $node['value'] ?? null;
    }

    /* ------------------------------------------------------------------ *
     * Document helpers
     * ------------------------------------------------------------------ */

    /**
     * @param array<string, mixed>|string|null $document
     * @return array{version: string, generator?: string, operators: array<string, mixed>, root: array<string, mixed>}
     */
    public static function normaliseDocument(array|string|null $document): array
    {
        if (is_string($document)) {
            $trimmed = trim($document);
            if ($trimmed === '') {
                $document = null;
            } else {
                $decoded = json_decode($trimmed, true);
                if (!is_array($decoded)) {
                    throw new ConditionException('Document is not valid JSON');
                }
                $document = $decoded;
            }
        }

        if (!is_array($document)) {
            return ['version' => self::SPEC_VERSION, 'operators' => [], 'root' => self::emptyGroup()];
        }

        $type = $document['type'] ?? null;
        if ($type === 'group' || $type === 'condition') {
            return [
                'version' => self::SPEC_VERSION,
                'operators' => [],
                'root' => $type === 'group'
                    ? $document
                    : ['type' => 'group', 'operator' => 'and', 'children' => [$document]],
            ];
        }

        return [
            'version' => (string) ($document['version'] ?? self::SPEC_VERSION),
            'generator' => $document['generator'] ?? null,
            'operators' => is_array($document['operators'] ?? null) ? $document['operators'] : [],
            'root' => is_array($document['root'] ?? null) ? $document['root'] : self::emptyGroup(),
        ];
    }

    /** @return array<string, mixed> */
    public static function emptyGroup(): array
    {
        return ['type' => 'group', 'operator' => 'and', 'negate' => false, 'children' => []];
    }

    /** @param array<string, mixed>|string|null $document */
    public static function isEmptyDocument(array|string|null $document): bool
    {
        $doc = self::normaliseDocument($document);

        return count($doc['root']['children'] ?? []) === 0;
    }

    /**
     * Validate a document's structure. Returns a list of problems; empty means valid.
     *
     * @param array<string, mixed>|string|null $document
     * @param array{fields?: array<int, string|array<string, mixed>>, operators?: array<string, mixed>} $options
     * @return array<int, array{path: string, code: string, params: array<string, mixed>, message: string}>
     */
    public static function validateDocument(array|string|null $document, array $options = []): array
    {
        $doc = self::normaliseDocument($document);
        $problems = [];
        $fieldNames = null;
        if (isset($options['fields'])) {
            $fieldNames = array_map(
                static fn ($f) => is_string($f) ? $f : (string) ($f['name'] ?? ''),
                $options['fields']
            );
        }
        $extra = $options['operators'] ?? [];

        $meta = static function (string $name) use ($doc, $extra): ?array {
            if (isset($extra[$name]) && is_array($extra[$name])) {
                return $extra[$name];
            }
            if (isset($doc['operators'][$name]) && is_array($doc['operators'][$name])) {
                return $doc['operators'][$name];
            }
            $builtin = Operators::meta()[$name] ?? null;

            return is_array($builtin) ? $builtin : null;
        };

        // Each problem carries a `code` and the `params` its message was built
        // from, as well as the English `message`, so a caller can say the same
        // thing in another language.
        $report = static function (string $path, string $code, array $params = []) use (&$problems): void {
            $problems[] = [
                'path' => $path,
                'code' => $code,
                'params' => $params,
                'message' => Labels::fillTemplate(self::PROBLEM_MESSAGES[$code], $params),
            ];
        };

        $walk = function (mixed $node, string $path) use (&$walk, $report, $fieldNames, $meta): void {
            if (!is_array($node)) {
                $report($path, 'notObject');

                return;
            }
            $type = $node['type'] ?? null;
            if ($type === 'group') {
                if (!in_array($node['operator'] ?? null, ['and', 'or'], true)) {
                    $report($path, 'groupOperator');
                }
                if (!is_array($node['children'] ?? null)) {
                    $report($path, 'groupChildren');

                    return;
                }
                foreach ($node['children'] as $i => $child) {
                    $walk($child, $path . '.children[' . $i . ']');
                }

                return;
            }
            if ($type !== 'condition') {
                $report($path, 'nodeType', ['type' => $type === null ? 'undefined' : (string) $type]);

                return;
            }
            $field = $node['field'] ?? null;
            if (!$field) {
                $report($path, 'noField');
            } elseif ($fieldNames !== null && !in_array($field, $fieldNames, true)) {
                $report($path, 'unknownField', ['field' => (string) $field]);
            }

            $opName = (string) ($node['operator'] ?? '');
            $m = $meta($opName);
            if ($m === null) {
                $report($path, 'unknownOperator', ['operator' => $opName]);

                return;
            }
            $arity = $m['arity'] ?? 1;
            $values = is_array($node['values'] ?? null) ? $node['values'] : [];
            if ($arity === 'n') {
                if (count($values) !== 1) {
                    $report($path, 'listArity', ['operator' => $opName]);
                }
            } elseif (count($values) !== (int) $arity) {
                $report($path, 'arity', ['operator' => $opName, 'expected' => (int) $arity, 'actual' => count($values)]);
            }
            foreach ($values as $i => $v) {
                $vPath = $path . '.values[' . $i . ']';
                if (!is_array($v)) {
                    $report($vPath, 'valueNotObject');

                    continue;
                }
                $source = $v['source'] ?? null;
                if ($source === 'field') {
                    if (empty($v['field'])) {
                        $report($vPath, 'valueNoField');
                    } elseif ($fieldNames !== null && !in_array($v['field'], $fieldNames, true)) {
                        $report($vPath, 'unknownField', ['field' => (string) $v['field']]);
                    }
                } elseif ($source !== 'literal') {
                    $report($vPath, 'valueSource');
                }
            }
        };

        $walk($doc['root'], 'root');

        return $problems;
    }

    /**
     * Render a document as a readable expression.
     *
     * @param array<string, mixed>|string|null $document
     * @param array{fields?: array<int, string|array<string, mixed>>, operators?: array<string, mixed>, emptyText?: string} $options
     */
    /**
     * The rule as a plain-English sentence.
     */
    public static function describe(array|string|null $document, array $options = []): string
    {
        return self::describeWith($document, $options, self::textFormat());
    }

    /**
     * The same sentence, marked up: the field in <strong>, the operator and
     * value in spans you can style.
     *
     * Everything taken from the document is escaped. Field labels and values
     * come out of a document that arrived from a browser — untrusted input by
     * definition — so escaping is not optional and not the caller's job.
     */
    public static function describeHtml(array|string|null $document, array $options = []): string
    {
        return self::describeWith($document, $options, self::htmlFormat());
    }

    /** @return array<string, callable> */
    private static function textFormat(): array
    {
        return [
            'field' => static fn (string $s): string => '[' . $s . ']',
            'op' => static fn (string $s): string => $s,
            'value' => static fn (string $s, bool $quoted): string => $quoted ? '"' . $s . '"' : $s,
            'list' => static fn (array $parts): string => '[' . implode(', ', $parts) . ']',
            'logic' => static fn (string $s, string $op): string => $s,
            'not' => static fn (string $s): string => $s,
            'open' => static fn (): string => '(',
            'close' => static fn (): string => ')',
            'join' => static fn (string $s): string => $s,
            'document' => static fn (string $s): string => $s,
            'escape' => static fn (string $s): string => $s,
        ];
    }

    /** @return array<string, callable> */
    private static function htmlFormat(): array
    {
        $esc = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

        return [
            'field' => static fn (string $s): string => '<strong class="kcd-field">' . $esc($s) . '</strong>',
            'op' => static fn (string $s): string => '<span class="kcd-op">' . $esc($s) . '</span>',
            // No quotes: the styling delimits the value, and quotes inside a
            // coloured, underlined span read as part of the value itself.
            'value' => static fn (string $s, bool $quoted): string => '<span class="kcd-value">' . $esc($s) . '</span>',
            'list' => static fn (array $parts): string =>
                '<span class="kcd-list">' . implode('<span class="kcd-sep">, </span>', $parts) . '</span>',
            // The class is the operator, not the word: a translated "OR" still
            // wants the OR colour.
            'logic' => static fn (string $s, string $op): string =>
                '<span class="kcd-logic kcd-' . ($op === 'or' ? 'or' : 'and') . '">' . $esc($s) . '</span>',
            'not' => static fn (string $s): string => '<span class="kcd-not">' . $esc($s) . '</span>',
            'open' => static fn (): string => '<span class="kcd-paren">(</span>',
            'close' => static fn (): string => '<span class="kcd-paren">)</span>',
            'join' => static fn (string $s): string => '<span class="kcd-join">' . $esc($s) . '</span>',
            'document' => static fn (string $s): string => '<span class="kcd">' . $s . '</span>',
            'escape' => $esc,
        ];
    }

    /**
     * One walk, two formatters. The bracketing rules, the NOT placement and the
     * label lookups live here only, so the plain-text and HTML renderings
     * cannot come to different conclusions about the same rule.
     *
     * @param array<string, callable> $f
     */
    private static function describeWith(array|string|null $document, array $options, array $f): string
    {
        $doc = self::normaliseDocument($document);
        // The editor's own `labels` object can be passed as it is: the words of
        // the rule (AND, OR, NOT, the "and" of `between`, the empty text) and
        // the operator names in `labels.operators`. Anything missing is English.
        $labels = is_array($options['labels'] ?? null) ? $options['labels'] : [];
        $opNames = is_array($labels['operators'] ?? null) ? $labels['operators'] : [];
        $words = [
            'and' => (string) Labels::labelOr($labels, 'and', 'AND'),
            'or' => (string) Labels::labelOr($labels, 'or', 'OR'),
            'not' => (string) Labels::labelOr($labels, 'not', 'NOT'),
            'join' => (string) Labels::labelOr($labels, 'andJoin', 'and'),
        ];
        $labelFor = [];
        $choiceLabels = [];
        foreach (($options['fields'] ?? []) as $field) {
            if (is_string($field)) {
                $labelFor[$field] = $field;
                continue;
            }
            if (!is_array($field) || !isset($field['name'])) {
                continue;
            }
            $labelFor[$field['name']] = $field['label'] ?? $field['name'];
            if (isset($field['choices'])) {
                $map = [];
                foreach (Values::normaliseChoices($field['choices']) as $c) {
                    $map[Values::asString($c['value'])] = (string) $c['label'];
                }
                $choiceLabels[$field['name']] = $map;
            }
        }
        $extra = $options['operators'] ?? [];

        $opLabel = static function (string $name) use ($doc, $extra, $opNames): string {
            $own = Labels::labelOr($opNames, $name, null);
            if ($own !== null) {
                return $own;
            }
            $m = $extra[$name] ?? $doc['operators'][$name] ?? Operators::meta()[$name] ?? null;

            return is_array($m) && isset($m['label']) ? (string) $m['label'] : $name;
        };
        $arityOf = static function (string $name) use ($doc, $extra): int|string {
            $m = $extra[$name] ?? $doc['operators'][$name] ?? Operators::meta()[$name] ?? null;

            return is_array($m) ? ($m['arity'] ?? 1) : 1;
        };
        // A substring or a pattern is not one of the field's choices, so it must
        // not be swapped for a choice label: `contains "FL"` is looking for the
        // letters F and L, and rendering it as `contains "Florida"` misreads the
        // rule. Only operators comparing against a whole value get the label.
        $usesChoices = static function (string $name) use ($doc, $extra): bool {
            $m = $extra[$name] ?? $doc['operators'][$name] ?? Operators::meta()[$name] ?? null;

            return !is_array($m) || ($m['valueFromChoices'] ?? true) !== false;
        };
        $fieldLabel = static fn (string $n): string => (string) ($labelFor[$n] ?? $n);

        // A rule reads better as "State is equal to Florida" than as "FL".
        $choiceLabel = static function (string $fieldName, mixed $value) use ($choiceLabels): ?string {
            $map = $choiceLabels[$fieldName] ?? null;

            return $map === null ? null : ($map[Values::asString($value)] ?? null);
        };

        $scalar = static function (mixed $raw, string $fieldName, bool $useChoices) use ($f, $choiceLabel): string {
            $label = $useChoices ? $choiceLabel($fieldName, $raw) : null;
            if ($label !== null) {
                return $f['value']($label, true);
            }
            if (is_string($raw)) {
                return $f['value']($raw, true);
            }

            return $f['value']((string) json_encode($raw), false);
        };

        $valueText = static function (mixed $v, string $fieldName, bool $useChoices) use ($f, $fieldLabel, $scalar): string {
            if (!is_array($v)) {
                return $f['value']((string) json_encode($v), is_string($v));
            }
            if (($v['source'] ?? null) === 'field') {
                return $f['field']($fieldLabel((string) ($v['field'] ?? '')));
            }
            $val = $v['value'] ?? null;
            if (is_array($val)) {
                $parts = [];
                foreach ($val as $x) {
                    $parts[] = $scalar($x, $fieldName, $useChoices);
                }

                return $f['list']($parts);
            }

            return $scalar($val, $fieldName, $useChoices);
        };

        $node = function (mixed $n) use (&$node, $f, $words, $opLabel, $arityOf, $fieldLabel, $valueText, $usesChoices): string {
            if (!is_array($n)) {
                return '';
            }
            if (($n['type'] ?? null) === 'group') {
                $parts = [];
                foreach (($n['children'] ?? []) as $child) {
                    $text = $node($child);
                    if ($text !== '') {
                        $parts[] = $text;
                    }
                }
                if (!$parts) {
                    return '';
                }
                $op = ($n['operator'] ?? 'and') === 'or' ? 'or' : 'and';
                $joined = implode(' ' . $f['logic']($words[$op], $op) . ' ', $parts);
                $wrapped = count($parts) > 1 ? $f['open']() . $joined . $f['close']() : $joined;

                return !empty($n['negate'])
                    ? $f['not']($words['not']) . ' ' . (count($parts) > 1 ? $wrapped : $f['open']() . $wrapped . $f['close']())
                    : $wrapped;
            }
            $opName = (string) ($n['operator'] ?? '');
            $fieldName = (string) ($n['field'] ?? '');
            $values = is_array($n['values'] ?? null) ? $n['values'] : [];
            $useChoices = $usesChoices($opName);
            $operands = '';
            if ($arityOf($opName) === 2 && count($values) === 2) {
                $operands = $valueText($values[0], $fieldName, $useChoices)
                    . $f['join'](' ' . $words['join'] . ' ') . $valueText($values[1], $fieldName, $useChoices);
            } elseif ($values) {
                $rendered = [];
                foreach ($values as $v) {
                    $rendered[] = $valueText($v, $fieldName, $useChoices);
                }
                $operands = implode($f['join'](', '), $rendered);
            }
            // An operator label with a {value} slot has its operand put there —
            // "is within the last 7 days" — and the words either side of it are
            // both the operator's. Without one, the operand follows the label.
            $label = $opLabel($opName);
            $slot = Labels::splitOperatorLabel($label);
            $text = $f['field']($fieldLabel($fieldName)) . ' ';
            if ($slot === null) {
                $text .= $f['op']($label) . ($operands !== '' ? ' ' . $operands : '');
            } elseif ($operands === '') {
                $text .= $f['op'](Labels::operatorLabelText($label));
            } else {
                $text .= ($slot['head'] !== '' ? $f['op']($slot['head']) . $slot['before'] : '') . $operands
                    . ($slot['tail'] !== '' ? $slot['after'] . $f['op']($slot['tail']) : '');
            }

            return !empty($n['negate']) ? $f['not']($words['not']) . ' ' . $f['open']() . $text . $f['close']() : $text;
        };

        $out = $node($doc['root']);
        if ($out === '') {
            $empty = $options['emptyText'] ?? null;
            $empty = is_string($empty) && $empty !== '' ? $empty : (string) Labels::labelOr($labels, 'empty', 'Always');

            return $f['document']($f['escape']($empty));
        }

        return $f['document']($out);
    }
}
