import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './UserManagement.css';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    name: '',
    phone: '',
    role: 'candidate',
    experience_years: 0,
    age: 0,
    previous_experience: ''
  });
  const { user, token } = useAuth();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/users`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }

      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError('Error fetching users: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (uid, newRole) => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/users/${uid}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      });

      if (!response.ok) {
        throw new Error('Failed to update role');
      }

      setSuccess('User role updated successfully');
      fetchUsers(); // Refresh the list
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Error updating role: ' + err.message);
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/users/register-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newUser,
          uid: `manual-${Date.now()}`, // Generate a temporary UID for manual registration
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add user');
      }

      setSuccess('User added successfully');
      setShowAddUser(false);
      setNewUser({
        email: '',
        name: '',
        phone: '',
        role: 'candidate',
        experience_years: 0,
        age: 0,
        previous_experience: ''
      });
      fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Error adding user: ' + err.message);
      setTimeout(() => setError(''), 3000);
    }
  };

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'admin': return 'role-badge admin';
      case 'staff': return 'role-badge staff';
      case 'candidate': return 'role-badge candidate';
      default: return 'role-badge';
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="user-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="user-management">
      <div className="user-management-header">
        <h2>User Management</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowAddUser(true)}
        >
          Add New User
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <span className="alert-icon">✅</span>
          {success}
        </div>
      )}

      <div className="users-stats">
        <div className="stat-card">
          <h3>{users.filter(u => u.role === 'admin').length}</h3>
          <p>Admins</p>
        </div>
        <div className="stat-card">
          <h3>{users.filter(u => u.role === 'staff').length}</h3>
          <p>Staff</p>
        </div>
        <div className="stat-card">
          <h3>{users.filter(u => u.role === 'candidate').length}</h3>
          <p>Candidates</p>
        </div>
        <div className="stat-card">
          <h3>{users.length}</h3>
          <p>Total Users</p>
        </div>
      </div>

      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>User Info</th>
              <th>Contact</th>
              <th>Role</th>
              <th>Experience</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((userItem) => (
              <tr key={userItem.uid}>
                <td>
                  <div className="user-info">
                    <div className="user-avatar">
                      {userItem.photo ? (
                        <img src={`${process.env.REACT_APP_API_URL}${userItem.photo}`} alt="Profile" />
                      ) : (
                        <div className="avatar-placeholder">
                          {userItem.name ? userItem.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                      )}
                    </div>
                    <div className="user-details">
                      <h4>{userItem.name || 'No Name'}</h4>
                      <p>{userItem.email}</p>
                      {userItem.age && <span className="age-badge">Age: {userItem.age}</span>}
                    </div>
                  </div>
                </td>
                <td>
                  <div className="contact-info">
                    <p>{userItem.phone || 'No phone'}</p>
                  </div>
                </td>
                <td>
                  <span className={getRoleBadgeClass(userItem.role)}>
                    {userItem.role}
                  </span>
                </td>
                <td>
                  <div className="experience-info">
                    <span className="exp-years">{userItem.experience_years || 0} years</span>
                    {userItem.previous_experience && (
                      <p className="prev-exp">{userItem.previous_experience}</p>
                    )}
                  </div>
                </td>
                <td>
                  <span className="join-date">
                    {userItem.createdAt ? formatDate(userItem.createdAt) : 'N/A'}
                  </span>
                </td>
                <td>
                  <div className="user-actions">
                    <select
                      value={userItem.role}
                      onChange={(e) => updateUserRole(userItem.uid, e.target.value)}
                      className="role-select"
                      disabled={userItem.uid === user?.uid} // Prevent self role change
                    >
                      <option value="candidate">Candidate</option>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add New User</h3>
              <button 
                className="close-btn"
                onClick={() => setShowAddUser(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAddUser} className="add-user-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={newUser.phone}
                    onChange={(e) => setNewUser({...newUser, phone: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Role *</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                    required
                  >
                    <option value="candidate">Candidate</option>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Age</label>
                  <input
                    type="number"
                    value={newUser.age}
                    onChange={(e) => setNewUser({...newUser, age: parseInt(e.target.value) || 0})}
                    min="0"
                  />
                </div>
                <div className="form-group">
                  <label>Experience (Years)</label>
                  <input
                    type="number"
                    value={newUser.experience_years}
                    onChange={(e) => setNewUser({...newUser, experience_years: parseInt(e.target.value) || 0})}
                    min="0"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Previous Experience</label>
                <textarea
                  value={newUser.previous_experience}
                  onChange={(e) => setNewUser({...newUser, previous_experience: e.target.value})}
                  rows="3"
                  placeholder="Describe previous work experience..."
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;