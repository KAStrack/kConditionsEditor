/* Shared demo configuration for the documentation pages. */
/* global window */

window.DEMO_FIELDS = [
  // `column` is the SQL name; `name` is the key in the document and in the data
  // you evaluate against. They are allowed to differ.
  { name: 'name', label: 'Name', type: 'text', column: 'c.full_name' },
  {
    name: 'email',
    label: 'Email',
    type: 'text',
    column: 'c.email',
    // Email may only be compared against the other address field.
    comparableWith: ['billing_email']
  },
  { name: 'billing_email', label: 'Billing Email', type: 'text', column: 'c.billing_email', comparableWith: ['email'] },
  { name: 'telephone', label: 'Telephone', type: 'text', column: 'c.telephone', comparableWith: false },
  {
    name: 'subject',
    label: 'Subject',
    type: 'enum',
    column: 'e.subject',
    // Choices as an associative map: the key is stored, the value is shown.
    choices: { sales: 'Sales', support: 'Support', billing: 'Billing', other: 'Something else' },
    comparableWith: false
  },
  { name: 'question', label: 'Question', type: 'text', column: 'e.body', comparableWith: false },
  { name: 'dob', label: 'Date of Birth', type: 'date', column: 'c.date_of_birth' },
  { name: 'signup_date', label: 'Signup Date', type: 'date', column: 'c.created_at' },
  {
    name: 'state',
    label: 'State',
    type: 'enum',
    column: 'a.state_code',
    // The other associative form: [{ value, label }].
    choices: [
      { value: 'AL', label: 'Alabama' }, { value: 'CA', label: 'California' },
      { value: 'FL', label: 'Florida' }, { value: 'LA', label: 'Louisiana' },
      { value: 'MS', label: 'Mississippi' }, { value: 'NV', label: 'Nevada' },
      { value: 'NY', label: 'New York' }, { value: 'TX', label: 'Texas' }
    ],
    comparableWith: false,
    // The two custom operators below are offered on this field only.
    operators: ['group:equality', 'in_list', 'not_in_list', 'is_gulf_state', 'group:existence']
  },
  { name: 'score', label: 'Lead Score', type: 'number', column: 'c.lead_score' },
  { name: 'subscribed', label: 'Subscribed', type: 'boolean', column: 'c.subscribed', comparableWith: false }
];

window.DEMO_OPERATORS = {
  /* A custom operator defined as a fixed set of values. */
  is_gulf_state: {
    kind: 'values',
    label: 'is a Gulf state',
    group: 'custom',
    match: 'in',
    arity: 0,
    values: { FL: 'Florida', LA: 'Louisiana', TX: 'Texas', MS: 'Mississippi', AL: 'Alabama' }
  },

  /* A custom operator that dispatches to a host function. Server-only: on the
     client it is skipped, so the rest of the rule can still be pre-checked. */
  email_is_unique: {
    kind: 'callback',
    label: 'is not already registered',
    group: 'custom',
    arity: 0,
    appliesTo: ['email', 'billing_email'],
    availableIn: ['server'],
    callbacks: {
      php: { class: '\\App\\Rules\\Email', method: 'isUnique', static: true },
      js: { function: 'emailIsUnique' },
      python: { module: 'app.rules', function: 'email_is_unique' }
    },
    policy: {
      unresolved: { client: 'skip', server: 'error', '*': 'error' },
      error: { client: 'skip', '*': 'error' }
    },
    // With a SQL template the operator translates too, instead of being skipped.
    sql: 'NOT EXISTS (SELECT 1 FROM contacts x WHERE x.email = {field})'
  }
};

window.DEMO_DATA = {
  name: 'benjamin',
  email: 'ben@example.com',
  billing_email: 'ben@example.com',
  telephone: '',
  subject: 'support',
  question: 'Can I get a refund please',
  dob: '1981-04-02',
  signup_date: '2026-08-10',
  state: 'TX',
  score: 72,
  subscribed: true
};

window.DEMO_STARTER = {
  version: '1.0',
  generator: 'kConditionsEditor/0.0.34',
  operators: {
    is_gulf_state: window.DEMO_OPERATORS.is_gulf_state
  },
  root: {
    type: 'group',
    operator: 'and',
    children: [
      { type: 'condition', field: 'name', operator: 'regex', values: [{ source: 'literal', value: '^ben' }] },
      {
        type: 'group',
        operator: 'or',
        children: [
          { type: 'condition', field: 'dob', operator: 'date_before', values: [{ source: 'literal', value: '1980-01-01' }] },
          {
            type: 'group',
            operator: 'and',
            children: [
              { type: 'condition', field: 'dob', operator: 'date_before', values: [{ source: 'literal', value: '1982-01-01' }] },
              { type: 'condition', field: 'state', operator: 'is_gulf_state', values: [] }
            ]
          }
        ]
      }
    ]
  }
};
