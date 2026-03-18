export const samples = [
  {
    label: 'Welcome Email',
    mode: 'email',
    template: `%%[
SET @subKey = AttributeValue('SubscriberKey')
SET @firstName = Lookup('Subscribers', 'FirstName', 'SubscriberKey', @subKey)
SET @tier = Lookup('Subscribers', 'LoyaltyTier', 'SubscriberKey', @subKey)
SET @city = Lookup('Subscribers', 'City', 'SubscriberKey', @subKey)
SET @orders = LookupRows('Orders', 'SubscriberKey', @subKey)
SET @orderCount = RowCount(@orders)
]%%
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#032d60;">
    <tr>
      <td style="padding:24px 32px;">
        <span style="color:#fff;font-size:22px;font-weight:bold;">&#9728; Salesforce</span>
      </td>
    </tr>
  </table>

  <!-- Hero -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0070d2;">
    <tr>
      <td style="padding:40px 32px;color:#fff;text-align:center;">
        <h1 style="margin:0 0 8px;font-size:28px;">Welcome back, %%=v(@firstName)=%%!</h1>
        <p style="margin:0;font-size:16px;opacity:.9;">Your %%=v(@tier)=%% member benefits await in %%=v(@city)=%%.</p>
      </td>
    </tr>
  </table>

  <!-- Body -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:32px;">

        %%[
        IF @tier == 'Platinum' THEN
        ]%%
        <p style="background:#f4f4f4;border-left:4px solid #ffb75d;padding:12px 16px;margin:0 0 24px;">
          &#11088; <strong>Platinum Exclusive:</strong> You have complimentary access to our priority support line.
        </p>
        %%[
        ELSEIF @tier == 'Gold' THEN
        ]%%
        <p style="background:#f4f4f4;border-left:4px solid #ffd700;padding:12px 16px;margin:0 0 24px;">
          &#127775; <strong>Gold Member Perk:</strong> Enjoy 15% off your next order — use code <strong>GOLD15</strong>.
        </p>
        %%[
        ELSEIF @tier == 'Silver' THEN
        ]%%
        <p style="background:#f4f4f4;border-left:4px solid #c0c0c0;padding:12px 16px;margin:0 0 24px;">
          &#127774; <strong>Silver Member:</strong> You're 200 points away from Gold status!
        </p>
        %%[
        ELSE
        ]%%
        <p style="background:#f4f4f4;border-left:4px solid #0070d2;padding:12px 16px;margin:0 0 24px;">
          &#127873; Welcome! Complete your profile to start earning loyalty points.
        </p>
        %%[
        ENDIF
        ]%%

        <h2 style="font-size:18px;color:#032d60;margin:0 0 16px;">Your Recent Orders (%%=v(@orderCount)=%%)</h2>

        %%[
        IF @orderCount > 0 THEN
          FOR @i = 1 TO @orderCount DO
            SET @row = Row(@orders, @i)
            SET @prodName = Field(@row, 'ProductName')
            SET @qty = Field(@row, 'Quantity')
            SET @price = Field(@row, 'UnitPrice')
            SET @status = Field(@row, 'Status')
            SET @oDate = Field(@row, 'OrderDate')
        ]%%
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:4px;margin-bottom:12px;">
          <tr>
            <td style="padding:12px 16px;">
              <strong>%%=v(@prodName)=%%</strong>
              <span style="color:#666;font-size:13px;"> &mdash; Qty: %%=v(@qty)=%% &nbsp;|&nbsp; $%%=v(@price)=%%</span>
            </td>
            <td style="padding:12px 16px;text-align:right;">
              <span style="background:#e8f4e8;color:#2e7d32;padding:4px 10px;border-radius:12px;font-size:12px;">%%=v(@status)=%%</span>
            </td>
          </tr>
        </table>
        %%[
          NEXT
        ELSE
        ]%%
        <p style="color:#666;">No orders yet. <a href="#" style="color:#0070d2;">Browse our products</a></p>
        %%[
        ENDIF
        ]%%

        <div style="text-align:center;margin-top:32px;">
          <a href="#" style="background:#0070d2;color:#fff;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:bold;display:inline-block;">
            View My Account
          </a>
        </div>

      </td>
    </tr>
  </table>

  <!-- Footer -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-top:1px solid #e0e0e0;">
    <tr>
      <td style="padding:20px 32px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0 0 8px;">You received this email because you are a %%=v(@tier)=%% member.</p>
        <p style="margin:0;">
          <a href="%%profile_center_url%%" style="color:#0070d2;">Manage Preferences</a> &nbsp;|&nbsp;
          <a href="%%unsub_center_url%%" style="color:#0070d2;">Unsubscribe</a>
        </p>
      </td>
    </tr>
  </table>

</div>`,
  },

  {
    label: 'Product Recommendation Email',
    mode: 'email',
    template: `%%[
SET @subKey = 'sub001'
SET @firstName = Lookup('Subscribers', 'FirstName', 'SubscriberKey', @subKey)
SET @category = 'Software'
SET @products = LookupRows('Products', 'Category', @category)
SET @count = RowCount(@products)
]%%
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#032d60;">
    <tr>
      <td style="padding:24px 32px;">
        <span style="color:#fff;font-size:22px;font-weight:bold;">&#9728; Salesforce</span>
      </td>
    </tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:32px;">
        <h2 style="color:#032d60;margin:0 0 8px;">Hi %%=v(@firstName)=%%,</h2>
        <p style="color:#444;margin:0 0 24px;">
          Here are our top <strong>%%=v(@category)=%%</strong> picks for you — %%=v(@count)=%% products selected just for your tier.
        </p>

        %%[
        FOR @i = 1 TO @count DO
          SET @row = Row(@products, @i)
          SET @name = Field(@row, 'Name')
          SET @price = Field(@row, 'Price')
          SET @desc = Field(@row, 'Description')
          SET @img = Field(@row, 'ImageURL')
          SET @inStock = Field(@row, 'InStock')
        ]%%
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:6px;margin-bottom:16px;overflow:hidden;">
          <tr>
            <td width="160" style="padding:0;vertical-align:top;">
              <img src="%%=v(@img)=%%" width="160" style="display:block;" alt="%%=v(@name)=%%">
            </td>
            <td style="padding:16px;vertical-align:top;">
              <strong style="font-size:16px;color:#032d60;">%%=v(@name)=%%</strong><br>
              <span style="font-size:13px;color:#666;">%%=v(@desc)=%%</span><br><br>
              <strong style="font-size:18px;color:#0070d2;">$%%=v(@price)=%%</strong>&nbsp;
              %%[
              IF @inStock == 'true' THEN
              ]%%
              <span style="background:#e8f4e8;color:#2e7d32;padding:3px 8px;border-radius:10px;font-size:11px;">In Stock</span>
              %%[
              ELSE
              ]%%
              <span style="background:#fdecea;color:#c62828;padding:3px 8px;border-radius:10px;font-size:11px;">Out of Stock</span>
              %%[
              ENDIF
              ]%%
              <br><br>
              <a href="#" style="background:#0070d2;color:#fff;padding:8px 20px;border-radius:4px;text-decoration:none;font-size:13px;">Learn More</a>
            </td>
          </tr>
        </table>
        %%[
        NEXT
        ]%%

      </td>
    </tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-top:1px solid #e0e0e0;">
    <tr>
      <td style="padding:20px 32px;text-align:center;color:#999;font-size:12px;">
        <a href="%%profile_center_url%%" style="color:#0070d2;">Manage Preferences</a> &nbsp;|&nbsp;
        <a href="%%unsub_center_url%%" style="color:#0070d2;">Unsubscribe</a>
      </td>
    </tr>
  </table>
</div>`,
  },

  {
    label: 'Landing Page — Registration',
    mode: 'landing-page',
    template: `%%[
/* Simulate query string: ?key=sub001 */
SET @subKey = 'sub001'
SET @firstName = Lookup('Subscribers', 'FirstName', 'SubscriberKey', @subKey)
SET @lastName = Lookup('Subscribers', 'LastName', 'SubscriberKey', @subKey)
SET @email = Lookup('Subscribers', 'EmailAddress', 'SubscriberKey', @subKey)
SET @tier = Lookup('Subscribers', 'LoyaltyTier', 'SubscriberKey', @subKey)
SET @isGoldOrAbove = IIF(@tier == 'Gold' OR @tier == 'Platinum', 'true', 'false')
]%%
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Event Registration</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f0f4f8; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 8px; max-width: 520px; margin: 0 auto; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
    h1 { color: #032d60; margin: 0 0 8px; font-size: 24px; }
    .subtitle { color: #666; margin: 0 0 28px; font-size: 14px; }
    label { display: block; font-size: 13px; font-weight: bold; color: #444; margin-bottom: 4px; }
    input, select { width: 100%; padding: 10px 12px; border: 1px solid #d0d0d0; border-radius: 4px; font-size: 14px; margin-bottom: 16px; box-sizing: border-box; }
    .perk { background: #f0f7ff; border: 1px solid #b3d9ff; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; font-size: 14px; color: #032d60; }
    button { width: 100%; background: #0070d2; color: #fff; border: none; padding: 14px; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer; }
    .footer { text-align: center; color: #aaa; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
<div class="card">
  <h1>Dreamforce 2026</h1>
  <p class="subtitle">Complete your registration, %%=v(@firstName)=%%</p>

  %%[
  IF @isGoldOrAbove == 'true' THEN
  ]%%
  <div class="perk">
    &#127775; <strong>%%=v(@tier)=%% Member Benefit:</strong> You qualify for the VIP lounge access and priority seating.
  </div>
  %%[
  ENDIF
  ]%%

  <form>
    <label>First Name</label>
    <input type="text" value="%%=v(@firstName)=%%" name="FirstName">

    <label>Last Name</label>
    <input type="text" value="%%=v(@lastName)=%%" name="LastName">

    <label>Email Address</label>
    <input type="email" value="%%=v(@email)=%%" name="EmailAddress">

    <label>Session Track</label>
    <select name="Track">
      <option>Sales Cloud</option>
      <option>Marketing Cloud</option>
      <option>Service Cloud</option>
      <option>Data + AI</option>
    </select>

    %%[
    IF @isGoldOrAbove == 'true' THEN
    ]%%
    <label>VIP Preference</label>
    <select name="VIPPref">
      <option>Morning Keynote Seating</option>
      <option>Executive Roundtable</option>
      <option>Product Roadmap Session</option>
    </select>
    %%[
    ENDIF
    ]%%

    <button type="submit">Complete Registration</button>
  </form>

  <div class="footer">
    Member since — Loyalty Tier: <strong>%%=v(@tier)=%%</strong><br>
    <a href="%%profile_center_url%%">Manage Preferences</a>
  </div>
</div>
</body>
</html>`,
  },

  {
    label: 'Simple Variable Test',
    mode: 'email',
    template: `%%[
SET @greeting = Concat('Hello, ', 'World')
SET @today = Now()
SET @upper = Uppercase('salesforce marketing cloud')
SET @sub = Substring('AMPscript Engine', 1, 9)
SET @num = Add(100, 25)
SET @firstName = Lookup('Subscribers', 'FirstName', 'SubscriberKey', 'sub001')
]%%
<div style="font-family:monospace;padding:24px;background:#f9f9f9;max-width:500px;">
  <h3 style="color:#032d60;">AMPscript Function Test</h3>
  <table cellpadding="6" style="border-collapse:collapse;width:100%;">
    <tr style="background:#e8f0fe;"><th align="left">Function</th><th align="left">Result</th></tr>
    <tr><td>Concat()</td><td><strong>%%=v(@greeting)=%%</strong></td></tr>
    <tr style="background:#f5f5f5;"><td>Now()</td><td><strong>%%=v(@today)=%%</strong></td></tr>
    <tr><td>Uppercase()</td><td><strong>%%=v(@upper)=%%</strong></td></tr>
    <tr style="background:#f5f5f5;"><td>Substring(1,9)</td><td><strong>%%=v(@sub)=%%</strong></td></tr>
    <tr><td>Add(100,25)</td><td><strong>%%=v(@num)=%%</strong></td></tr>
    <tr style="background:#f5f5f5;"><td>Lookup()</td><td><strong>%%=v(@firstName)=%%</strong></td></tr>
  </table>

  <h3 style="color:#032d60;margin-top:24px;">Personalization Strings</h3>
  <p>%%FirstName%% %%LastName%% &lt;%%EmailAddress%%&gt;</p>
</div>`,
  },
];
