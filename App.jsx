import React, { useState, useEffect, useRef } from 'react';

const API_URL = 'http://localhost:5000/api';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('login');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'bot', message: 'Hello! 👋 Welcome to TradeMind Pro support. How can I help you?' }
  ]);
  const [chatInput, setChatInput] = useState('');

  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [signupData, setSignupData] = useState({ email: '', password: '', name: '' });
  const [bots, setBots] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);

  useEffect(() => {
    if (token) {
      fetchUserProfile();
      setCurrentPage('dashboard');
    }
  }, []);

  const apiCall = async (endpoint, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'API error');
      }
      return response.json();
    } catch (err) {
      throw err;
    }
  };

  // Chat bot
  const handleChatSend = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage = chatInput;
    setChatMessages(prev => [...prev, { role: 'user', message: userMessage }]);
    setChatInput('');

    try {
      const response = await apiCall('/support/chat', {
        method: 'POST',
        body: JSON.stringify({ message: userMessage })
      });
      setChatMessages(prev => [...prev, { role: 'bot', message: response.response }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'bot', message: 'Sorry, I encountered an error. Please try again.' }]);
    }
  };

  // Auth functions
  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await apiCall('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(signupData)
      });
      setToken(data.token);
      localStorage.setItem('token', data.token);
      setCurrentUser(data.user);
      setCurrentPage('dashboard');
      setSuccess('Account created successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginData)
      });
      setToken(data.token);
      localStorage.setItem('token', data.token);
      setCurrentUser(data.user);
      setCurrentPage('dashboard');
      setSuccess('Logged in successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserProfile = async () => {
    try {
      const data = await apiCall('/user/profile');
      setCurrentUser(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const data = await apiCall('/dashboard/overview');
      setDashboardData(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchBots = async () => {
    try {
      const data = await apiCall('/bots');
      setBots(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchBrokers = async () => {
    try {
      const data = await apiCall('/brokers');
      setBrokers(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const data = await apiCall('/payments/methods');
      setPaymentMethods(data.methods);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateBot = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const botData = {
      name: document.getElementById('botName')?.value,
      symbol: document.getElementById('botSymbol')?.value,
      strategy: document.getElementById('botStrategy')?.value,
      broker: document.getElementById('botBroker')?.value,
      initial_capital: parseFloat(document.getElementById('botCapital')?.value)
    };

    try {
      await apiCall('/bots', {
        method: 'POST',
        body: JSON.stringify(botData)
      });
      setSuccess('Bot created successfully!');
      fetchBots();
      setTimeout(() => setCurrentPage('bots'), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectBroker = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const brokerData = {
      broker_name: document.getElementById('brokerName')?.value,
      account_login: document.getElementById('accountLogin')?.value,
      account_type: document.getElementById('accountType')?.value,
      api_key: document.getElementById('apiKey')?.value
    };

    try {
      const response = await apiCall('/brokers/connect', {
        method: 'POST',
        body: JSON.stringify(brokerData)
      });
      setSuccess(`${brokerData.broker_name} connected successfully!`);
      fetchBrokers();
      setTimeout(() => setCurrentPage('brokers'), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setToken('');
    setCurrentUser(null);
    localStorage.removeItem('token');
    setCurrentPage('login');
  };

  // Pages
  const LoginPage = () => (
    <div className="auth-container">
      <div className="auth-box">
        <h1 className="navbar-brand">🤖 TradeMind Pro</h1>
        <p style={{ color: '#7d8be8', marginBottom: '25px', textAlign: 'center' }}>
          AI-Powered Trading Bot Platform
        </p>

        {error && <div className="alert alert-error show">{error}</div>}
        {success && <div className="alert alert-success show">{success}</div>}

        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={loginData.email}
            onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={loginData.password}
            onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
            required
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: '#7d8be8', marginTop: '20px', fontSize: '14px' }}>
          Don't have an account?{' '}
          <button
            onClick={() => setCurrentPage('signup')}
            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );

  const SignupPage = () => (
    <div className="auth-container">
      <div className="auth-box">
        <h1 className="navbar-brand">🤖 TradeMind Pro</h1>
        <p style={{ color: '#7d8be8', marginBottom: '25px', textAlign: 'center' }}>Create Your Account</p>

        {error && <div className="alert alert-error show">{error}</div>}

        <form onSubmit={handleSignup}>
          <input
            type="text"
            placeholder="Full Name"
            value={signupData.name}
            onChange={(e) => setSignupData({ ...signupData, name: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={signupData.email}
            onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password (min 8 chars)"
            value={signupData.password}
            onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
            minLength="8"
            required
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: '#7d8be8', marginTop: '20px', fontSize: '14px' }}>
          Already have an account?{' '}
          <button
            onClick={() => setCurrentPage('login')}
            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Login
          </button>
        </p>
      </div>
    </div>
  );

  const DashboardPage = () => {
    useEffect(() => {
      fetchDashboardData();
      fetchBots();
    }, []);

    return (
      <div>
        <div className="section-header">
          <div className="section-title">Trading Dashboard</div>
          <button className="btn-primary" onClick={() => setCurrentPage('create-bot')}>+ New Bot</button>
        </div>

        {error && <div className="alert alert-error show">{error}</div>}
        {success && <div className="alert alert-success show">{success}</div>}

        {dashboardData && (
          <div className="grid">
            <div className="card">
              <div className="card-label">Portfolio Value</div>
              <div className="card-value">₱{dashboardData.portfolio_value?.toFixed(2)}</div>
              <div className="card-detail positive">↑ +₱{dashboardData.total_pnl} (+{dashboardData.total_pnl_percent}%)</div>
            </div>
            <div className="card">
              <div className="card-label">Active Bots</div>
              <div className="card-value">{dashboardData.active_bots}</div>
              <div className="card-detail">{dashboardData.profitable_bots} profitable</div>
            </div>
            <div className="card">
              <div className="card-label">Win Rate</div>
              <div className="card-value">{dashboardData.win_rate}%</div>
              <div className="card-detail">Last 30 days</div>
            </div>
            <div className="card">
              <div className="card-label">Monthly Return</div>
              <div className="card-value profit">{dashboardData.monthly_return}%</div>
              <div className="card-detail">This month</div>
            </div>
          </div>
        )}

        <div className="section-header" style={{ marginTop: '30px' }}>
          <div className="section-title">Your Bots ({bots.length})</div>
        </div>

        {bots.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ color: '#7d8be8' }}>No bots yet. Create your first trading bot!</p>
            <button className="btn-primary" onClick={() => setCurrentPage('create-bot')} style={{ marginTop: '15px' }}>
              Create First Bot
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Bot Name</th>
                <th>Pair</th>
                <th>Broker</th>
                <th>Strategy</th>
                <th>Status</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {bots.map(bot => (
                <tr key={bot.id}>
                  <td><strong>{bot.name}</strong></td>
                  <td>{bot.symbol}</td>
                  <td>{bot.broker}</td>
                  <td><span className="strategy-badge">{bot.strategy}</span></td>
                  <td><span className={`status-badge ${bot.status === 'active' ? 'status-active' : 'status-inactive'}`}>{bot.status}</span></td>
                  <td className={bot.current_pnl >= 0 ? 'profit' : 'loss'}>
                    ₱{bot.current_pnl?.toFixed(2) || '0.00'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const CreateBotPage = () => (
    <div>
      <div className="section-header">
        <div className="section-title">Create New Trading Bot</div>
        <button className="btn-secondary" onClick={() => setCurrentPage('dashboard')}>← Back</button>
      </div>

      {error && <div className="alert alert-error show">{error}</div>}
      {success && <div className="alert alert-success show">{success}</div>}

      <div className="card" style={{ maxWidth: '600px', margin: '20px auto' }}>
        <form onSubmit={handleCreateBot}>
          <label>Bot Name</label>
          <input type="text" id="botName" placeholder="e.g., EUR/USD Grid" required />

          <label>Trading Pair</label>
          <select id="botSymbol" required>
            <option value="">Select pair</option>
            <option value="EUR/USD">EUR/USD</option>
            <option value="GBP/USD">GBP/USD</option>
            <option value="USD/JPY">USD/JPY</option>
            <option value="XAU/USD">XAU/USD (Gold)</option>
            <option value="BTC/USD">BTC/USD</option>
          </select>

          <label>Broker</label>
          <select id="botBroker" required>
            <option value="">Select broker</option>
            <option value="Exness">Exness</option>
            <option value="XM Markets">XM Markets</option>
            <option value="Doto">Doto Finance</option>
          </select>

          <label>Strategy Type</label>
          <select id="botStrategy" required>
            <option value="">Select strategy</option>
            <option value="GRID">GRID - Ranging markets</option>
            <option value="DCA">DCA - Trending markets</option>
          </select>

          <label>Starting Capital (USD)</label>
          <input type="number" id="botCapital" placeholder="5000" min="100" required />

          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '20px' }} disabled={loading}>
            {loading ? 'Creating...' : 'Create Bot'}
          </button>
        </form>
      </div>
    </div>
  );

  const BrokersPage = () => {
    useEffect(() => {
      fetchBrokers();
    }, []);

    return (
      <div>
        <div className="section-header">
          <div className="section-title">Connected Brokers</div>
          <button className="btn-primary" onClick={() => setCurrentPage('connect-broker')}>+ Connect Broker</button>
        </div>

        {error && <div className="alert alert-error show">{error}</div>}
        {success && <div className="alert alert-success show">{success}</div>}

        <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', color: '#06b6d4' }}>
          💡 Supported Brokers: Exness (Fast & Reliable), XM Markets (Great Spreads), Doto (Crypto+Forex)
        </div>

        {brokers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ color: '#7d8be8' }}>No brokers connected. Connect your first broker account!</p>
            <button className="btn-primary" onClick={() => setCurrentPage('connect-broker')} style={{ marginTop: '15px' }}>
              Connect Broker
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Broker</th>
                <th>Account Type</th>
                <th>Balance</th>
                <th>Equity</th>
              </tr>
            </thead>
            <tbody>
              {brokers.map(broker => (
                <tr key={broker.id}>
                  <td><strong>{broker.broker_name}</strong></td>
                  <td>{broker.account_type}</td>
                  <td>${broker.balance?.toFixed(2)}</td>
                  <td>${broker.equity?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const ConnectBrokerPage = () => (
    <div>
      <div className="section-header">
        <div className="section-title">Connect Broker Account</div>
        <button className="btn-secondary" onClick={() => setCurrentPage('brokers')}>← Back</button>
      </div>

      {error && <div className="alert alert-error show">{error}</div>}
      {success && <div className="alert alert-success show">{success}</div>}

      <div className="card" style={{ maxWidth: '600px', margin: '20px auto' }}>
        <form onSubmit={handleConnectBroker}>
          <label>Select Broker</label>
          <select id="brokerName" required>
            <option value="">Choose broker</option>
            <option value="Exness">Exness (Recommended - Fast Execution)</option>
            <option value="XM Markets">XM Markets (Low Spreads)</option>
            <option value="Doto">Doto Finance (Crypto + Forex)</option>
          </select>

          <label>Account Login (Email/Username)</label>
          <input type="text" id="accountLogin" placeholder="Your broker account login" required />

          <label>Account Type</label>
          <select id="accountType" required>
            <option value="">Select account type</option>
            <option value="Standard">Standard</option>
            <option value="Pro">Pro</option>
            <option value="Micro">Micro</option>
          </select>

          <label>API Key / Password</label>
          <input type="password" id="apiKey" placeholder="Broker API key or account password" required />

          <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '12px', borderRadius: '6px', margin: '15px 0', fontSize: '12px', color: '#7d8be8' }}>
            🔒 Your credentials are encrypted and secure. We never expose your password.
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Connecting...' : 'Connect Broker'}
          </button>
        </form>
      </div>
    </div>
  );

  const SubscriptionPage = () => {
    const [selectedTier, setSelectedTier] = useState(null);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [showPaymentInstructions, setShowPaymentInstructions] = useState(false);
    const [paymentData, setPaymentData] = useState(null);

    useEffect(() => {
      fetchPaymentMethods();
    }, []);

    const handleUpgrade = async (tier) => {
      setSelectedTier(tier);
      setSelectedPaymentMethod(null);
      setShowPaymentInstructions(false);
    };

    const handlePaymentMethodSelect = async (method) => {
      setSelectedPaymentMethod(method);
      setLoading(true);

      try {
        const response = await apiCall('/payments/initiate', {
          method: 'POST',
          body: JSON.stringify({ tier: selectedTier, payment_method: method })
        });
        setPaymentData(response);
        setShowPaymentInstructions(true);
        setSuccess('Payment instructions generated!');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    const tiers = [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        currency: 'PHP',
        features: ['1 bot', '1 broker', 'Basic analytics']
      },
      {
        id: 'starter',
        name: 'Starter',
        price: 299,
        currency: 'PHP',
        features: ['3 bots', '2 brokers', 'Grid & DCA strategies', 'Email support']
      },
      {
        id: 'premium',
        name: 'Premium',
        price: 799,
        currency: 'PHP',
        features: ['10 bots', 'Unlimited brokers', 'AI strategy builder', 'Priority support']
      },
      {
        id: 'unlimited',
        name: 'Unlimited',
        price: 1999,
        currency: 'PHP',
        features: ['Unlimited bots', 'White-label', 'API access', '24/7 VIP support']
      }
    ];

    return (
      <div>
        <div className="section-header">
          <div className="section-title">Upgrade Your Plan</div>
        </div>

        {error && <div className="alert alert-error show">{error}</div>}
        {success && <div className="alert alert-success show">{success}</div>}

        <div className="tiers-grid">
          {tiers.map(tier => (
            <div key={tier.id} className={`tier-card ${tier.id === 'premium' ? 'featured' : ''}`}>
              <div className="tier-name">{tier.name}</div>
              <div className="tier-price">₱{tier.price}</div>
              {tier.price > 0 && <div className="tier-price-period">per month</div>}
              <ul className="tier-features">
                {tier.features.map((feature, idx) => (
                  <li key={idx}>{feature}</li>
                ))}
              </ul>
              {currentUser?.subscription_tier === tier.id ? (
                <button className="btn-secondary" style={{ width: '100%', marginTop: '15px' }}>Current Plan</button>
              ) : (
                <button 
                  className="btn-primary" 
                  style={{ width: '100%', marginTop: '15px' }}
                  onClick={() => handleUpgrade(tier.id)}
                >
                  {tier.price === 0 ? 'Select' : 'Upgrade'}
                </button>
              )}
            </div>
          ))}
        </div>

        {selectedTier && !showPaymentInstructions && (
          <div className="card" style={{ maxWidth: '600px', margin: '30px auto' }}>
            <h3 style={{ color: '#06b6d4', marginBottom: '20px' }}>Select Payment Method</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {paymentMethods.map(method => (
                <button
                  key={method.id}
                  onClick={() => handlePaymentMethodSelect(method.id)}
                  style={{
                    padding: '15px',
                    border: `2px solid ${selectedPaymentMethod === method.id ? '#6366f1' : 'rgba(99, 102, 241, 0.2)'}`,
                    background: selectedPaymentMethod === method.id ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                    borderRadius: '8px',
                    color: '#e0e6ff',
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                  disabled={loading}
                >
                  <div style={{ fontSize: '20px', marginBottom: '5px' }}>{method.icon}</div>
                  <div style={{ fontSize: '13px', fontWeight: '600' }}>{method.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {showPaymentInstructions && paymentData && (
          <div className="card" style={{ maxWidth: '700px', margin: '30px auto' }}>
            <h3 style={{ color: '#10b981', marginBottom: '20px' }}>✅ Payment Instructions</h3>
            
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #10b981' }}>
              <p style={{ color: '#10b981', fontWeight: '600', marginBottom: '5px' }}>Reference Number (IMPORTANT):</p>
              <p style={{ fontSize: '16px', fontWeight: '700', color: '#06b6d4', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {paymentData.reference_number}
              </p>
              <p style={{ fontSize: '12px', color: '#7d8be8', marginTop: '5px' }}>Please include this number in your payment/message</p>
            </div>

            {paymentData.payment_method === 'paypal' && (
              <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '15px' }}>
                <p><strong>PayPal Email:</strong> {paymentData.payment_instructions.recipient}</p>
                <p><strong>Amount:</strong> ₱{paymentData.payment_instructions.amount}</p>
                <p style={{ fontSize: '12px', color: '#7d8be8', marginTop: '10px' }}>Send payment to the email above and include the reference number in the description</p>
              </div>
            )}

            {paymentData.payment_method === 'bank_transfer' && (
              <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '15px' }}>
                <p><strong>Bank:</strong> {paymentData.payment_instructions.bank_name}</p>
                <p><strong>Account Holder:</strong> {paymentData.payment_instructions.account_holder}</p>
                <p><strong>Account Number:</strong> {paymentData.payment_instructions.account_number}</p>
                <p><strong>Amount:</strong> ₱{paymentData.payment_instructions.amount}</p>
                <p style={{ fontSize: '12px', color: '#7d8be8', marginTop: '10px' }}>Include reference number in transfer description</p>
              </div>
            )}

            {paymentData.payment_method === 'gcash' && (
              <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '15px' }}>
                <p><strong>GCash Number:</strong> {paymentData.payment_instructions.gcash_number}</p>
                <p><strong>Amount:</strong> ₱{paymentData.payment_instructions.amount}</p>
                <p style={{ fontSize: '12px', color: '#7d8be8', marginTop: '10px' }}>Send via GCash and include reference number in message</p>
              </div>
            )}

            {paymentData.payment_method === 'paymaya' && (
              <div style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '15px' }}>
                <p><strong>PayMaya Account:</strong> {paymentData.payment_instructions.account}</p>
                <p><strong>Amount:</strong> ₱{paymentData.payment_instructions.amount}</p>
                <p style={{ fontSize: '12px', color: '#7d8be8', marginTop: '10px' }}>Send payment and include reference number</p>
              </div>
            )}

            <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
              <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px' }}>⏳ <strong>Next Steps:</strong></p>
              <ol style={{ color: '#7d8be8', fontSize: '13px', marginLeft: '20px' }}>
                <li>Copy your reference number above</li>
                <li>Send payment using the method you selected</li>
                <li>Email us your payment receipt at: support@trademindpro.com</li>
                <li>We'll verify within 1-2 hours</li>
                <li>Your subscription will be activated immediately</li>
              </ol>
            </div>

            <button className="btn-secondary" style={{ width: '100%', marginTop: '20px' }} onClick={() => setCurrentPage('dashboard')}>
              ← Back to Dashboard
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPage = () => {
    if (!token) {
      return currentPage === 'signup' ? <SignupPage /> : <LoginPage />;
    }

    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'create-bot':
        return <CreateBotPage />;
      case 'brokers':
        return <BrokersPage />;
      case 'connect-broker':
        return <ConnectBrokerPage />;
      case 'subscription':
        return <SubscriptionPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="app">
      {token && (
        <div className="navbar">
          <div className="navbar-brand">🤖 TradeMind Pro</div>
          <div className="nav-links">
            <button className={`nav-link ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
            <button className={`nav-link ${currentPage === 'brokers' ? 'active' : ''}`} onClick={() => setCurrentPage('brokers')}>Brokers</button>
            <button className={`nav-link ${currentPage === 'subscription' ? 'active' : ''}`} onClick={() => setCurrentPage('subscription')}>
              {currentUser?.subscription_tier === 'free' ? '💎 Upgrade' : '✓ Plan'}
            </button>
            <div className="user-badge">
              {currentUser?.subscription_tier?.toUpperCase()} | {currentUser?.email?.substring(0, 10)}...
              <button onClick={handleLogout} style={{ marginLeft: '10px', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: '12px' }}>
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="container">
        {renderPage()}
      </div>

      {/* Chat Bot Widget */}
      {token && (
        <>
          <button 
            onClick={() => setShowChat(!showChat)}
            style={{
              position: 'fixed',
              bottom: '20px',
              right: '20px',
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
              border: 'none',
              color: 'white',
              fontSize: '28px',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
              zIndex: 999
            }}
          >
            💬
          </button>

          {showChat && (
            <div style={{
              position: 'fixed',
              bottom: '100px',
              right: '20px',
              width: '350px',
              maxHeight: '500px',
              background: 'rgba(30, 41, 80, 0.95)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
              zIndex: 999
            }}>
              <div style={{ padding: '15px', borderBottom: '1px solid rgba(99, 102, 241, 0.2)', background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)', borderRadius: '12px 12px 0 0', color: 'white', fontWeight: '600' }}>
                💬 Support Chat
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {chatMessages.map((msg, idx) => (
                  <div key={idx} style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    background: msg.role === 'user' ? 'rgba(99, 102, 241, 0.3)' : 'rgba(6, 182, 212, 0.2)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    maxWidth: '85%',
                    fontSize: '12px',
                    color: '#e0e6ff',
                    wordBreak: 'break-word'
                  }}>
                    {msg.message}
                  </div>
                ))}
              </div>

              <form onSubmit={handleChatSend} style={{ padding: '10px', borderTop: '1px solid rgba(99, 102, 241, 0.2)', display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question..."
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    background: 'rgba(10, 14, 39, 0.5)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    borderRadius: '6px',
                    color: '#e0e6ff',
                    fontSize: '12px'
                  }}
                />
                <button type="submit" style={{
                  padding: '8px 12px',
                  background: '#6366f1',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  Send
                </button>
              </form>
            </div>
          )}
        </>
      )}

      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%); color: #e0e6ff; min-height: 100vh; }
        .app { min-height: 100vh; }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        
        .navbar { background: rgba(20, 25, 47, 0.8); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(100, 150, 255, 0.1); padding: 0 20px; height: 70px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
        .navbar-brand { font-size: 22px; font-weight: 700; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .nav-links { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .nav-link { padding: 8px 16px; border: none; background: transparent; color: #b4bfff; cursor: pointer; border-radius: 6px; font-size: 14px; transition: all 0.3s; font-weight: 500; }
        .nav-link:hover, .nav-link.active { background: rgba(99, 102, 241, 0.2); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); }
        .user-badge { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 20px; font-size: 12px; color: #06b6d4; }
        
        .auth-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .auth-box { background: rgba(30, 41, 80, 0.6); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 12px; padding: 40px; width: 100%; max-width: 400px; backdrop-filter: blur(20px); }
        .auth-box h1 { text-align: center; margin-bottom: 10px; }
        .auth-box form { display: flex; flex-direction: column; gap: 15px; }
        
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .card { background: rgba(30, 41, 80, 0.6); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 12px; padding: 20px; backdrop-filter: blur(20px); transition: all 0.3s; }
        .card:hover { border-color: rgba(99, 102, 241, 0.4); background: rgba(30, 41, 80, 0.8); transform: translateY(-2px); }
        
        .card-label { font-size: 12px; color: #7d8be8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .card-value { font-size: 32px; font-weight: 700; color: #06b6d4; margin-bottom: 8px; }
        .card-detail { font-size: 13px; color: #7d8be8; }
        .card-detail.positive { color: #10b981; }
        
        button { padding: 10px 20px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; transition: all 0.2s; }
        .btn-primary { background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; border: 1px solid rgba(99, 102, 241, 0.3); }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary { background: rgba(99, 102, 241, 0.1); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); }
        .btn-secondary:hover { background: rgba(99, 102, 241, 0.2); }
        
        input, select { width: 100%; padding: 12px; background: rgba(10, 14, 39, 0.5); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; color: #e0e6ff; font-size: 14px; }
        input:focus, select:focus { outline: none; border-color: rgba(99, 102, 241, 0.5); background: rgba(10, 14, 39, 0.7); }
        label { display: block; margin-top: 10px; font-size: 13px; color: #7d8be8; font-weight: 600; }
        
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        thead { background: rgba(99, 102, 241, 0.1); border-top: 1px solid rgba(99, 102, 241, 0.2); border-bottom: 1px solid rgba(99, 102, 241, 0.2); }
        th { padding: 12px; text-align: left; color: #7d8be8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 14px 12px; border-bottom: 1px solid rgba(99, 102, 241, 0.1); font-size: 13px; }
        tr:hover { background: rgba(99, 102, 241, 0.05); }
        
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
        .status-active { background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
        .status-inactive { background: rgba(107, 114, 128, 0.2); color: #9ca3af; border: 1px solid rgba(107, 114, 128, 0.3); }
        
        .strategy-badge { display: inline-block; padding: 6px 12px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; font-size: 12px; color: #6366f1; }
        
        .alert { padding: 15px; border-radius: 8px; margin-bottom: 15px; display: none; border-left: 4px solid; }
        .alert.show { display: block; }
        .alert-success { background: rgba(16, 185, 129, 0.1); color: #10b981; border-color: #10b981; }
        .alert-error { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: #ef4444; }
        
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-wrap: wrap; gap: 15px; }
        .section-title { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        
        .profit { color: #10b981; }
        .loss { color: #ef4444; }
        
        .tiers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
        .tier-card { background: rgba(30, 41, 80, 0.6); border: 2px solid rgba(99, 102, 241, 0.2); border-radius: 12px; padding: 25px; text-align: center; transition: all 0.3s; }
        .tier-card.featured { border-color: rgba(99, 102, 241, 0.6); background: rgba(99, 102, 241, 0.15); transform: scale(1.05); }
        .tier-name { font-size: 20px; font-weight: 700; color: #06b6d4; margin-bottom: 10px; }
        .tier-price { font-size: 36px; font-weight: 700; color: #e0e6ff; margin: 15px 0; }
        .tier-price-period { font-size: 12px; color: #7d8be8; }
        .tier-features { list-style: none; margin: 25px 0; text-align: left; }
        .tier-features li { padding: 8px 0; color: #b4bfff; font-size: 13px; border-bottom: 1px solid rgba(99, 102, 241, 0.1); }
        .tier-features li:before { content: "✓ "; color: #10b981; font-weight: 700; margin-right: 8px; }
        
        @media (max-width: 768px) {
          .nav-links { flex-direction: column; width: 100%; }
          .navbar { flex-direction: column; height: auto; gap: 10px; }
          .tier-card.featured { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

export default App;
