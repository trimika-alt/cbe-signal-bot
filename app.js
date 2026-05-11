const { App, ExpressReceiver } = require('@slack/bolt');
const { google } = require('googleapis');
require('dotenv').config();

const OFFICES = ['Pittsburgh', 'NYC', 'London', 'Dublin', 'Beijing', 'Toronto', 'Remote'];
const AREAS = ['Culture', 'Belonging', 'Connection', 'Leadership', 'Mission alignment', 'Trust', 'Other'];

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function toOptions(values) {
  return values.map(v => ({
    text: { type: 'plain_text', text: v },
    value: v,
  }));
}

async function postToResponseUrl(responseUrl, text) {
  if (!responseUrl) return;
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', text, replace_original: false }),
    });
    if (!res.ok) {
      console.error('response_url POST returned', res.status, await res.text());
    }
  } catch (err) {
    console.error('response_url POST failed:', err);
  }
}

app.command('/cbe-signal', async ({ ack, body, client, logger }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'cbe_signal_submit',
        private_metadata: JSON.stringify({
          response_url: body.response_url,
          user_id: body.user_id,
        }),
        title: { type: 'plain_text', text: 'CBE Signal' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'signal_block',
            label: { type: 'plain_text', text: 'What did you hear or observe?' },
            element: {
              type: 'plain_text_input',
              action_id: 'signal_input',
              multiline: true,
            },
          },
          {
            type: 'input',
            block_id: 'office_block',
            label: { type: 'plain_text', text: 'Which office?' },
            element: {
              type: 'static_select',
              action_id: 'office_select',
              placeholder: { type: 'plain_text', text: 'Select an office' },
              options: toOptions(OFFICES),
            },
          },
          {
            type: 'input',
            block_id: 'area_block',
            label: { type: 'plain_text', text: 'What area does this relate to?' },
            element: {
              type: 'static_select',
              action_id: 'area_select',
              placeholder: { type: 'plain_text', text: 'Select an area' },
              options: toOptions(AREAS),
            },
          },
          {
            type: 'input',
            block_id: 'anon_block',
            label: { type: 'plain_text', text: 'Share anonymously?' },
            element: {
              type: 'static_select',
              action_id: 'anon_select',
              placeholder: { type: 'plain_text', text: 'Choose one' },
              options: [
                { text: { type: 'plain_text', text: 'Yes — keep me anonymous' }, value: 'yes' },
                { text: { type: 'plain_text', text: 'No — include my name' }, value: 'no' },
              ],
            },
          },
        ],
      },
    });
  } catch (err) {
    logger.error('Failed to open modal', err);
  }
});

app.view('cbe_signal_submit', async ({ ack, view, client, logger }) => {
  await ack();

  const meta = JSON.parse(view.private_metadata || '{}');
  const { response_url: responseUrl, user_id: userId } = meta;
  const v = view.state.values;
  const signal = v.signal_block.signal_input.value;
  const office = v.office_block.office_select.selected_option.value;
  const area = v.area_block.area_select.selected_option.value;
  const anonChoice = v.anon_block.anon_select.selected_option.value;
  const isAnonymous = anonChoice === 'yes';

  let submittedBy = '';
  if (!isAnonymous && userId) {
    try {
      const info = await client.users.info({ user: userId });
      submittedBy =
        info.user.profile?.display_name ||
        info.user.real_name ||
        info.user.name ||
        '';
    } catch (err) {
      logger.error('users.info lookup failed', err);
    }
  }

  const row = [
    new Date().toISOString(),
    office,
    area,
    signal,
    isAnonymous ? 'Yes' : 'No',
    submittedBy,
    'slash-command',
  ];

  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    await postToResponseUrl(
      responseUrl,
      "Got it — your signal has been logged. Thank you for helping CBE hear what's really happening."
    );
  } catch (err) {
    logger.error('Sheet append failed', err);
    await postToResponseUrl(
      responseUrl,
      'Something went wrong logging your signal. Please DM #culture-belonging-engagement directly.'
    );
  }
});

(async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.start(port);
  console.log(`CBE Signal bot listening on port ${port}`);
})();
