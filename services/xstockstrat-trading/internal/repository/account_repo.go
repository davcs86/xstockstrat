package repository

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BrokerAccountRecord is the DB representation of a registered broker account.
type BrokerAccountRecord struct {
	ID             string
	DisplayName    string
	BrokerType     int32
	IsPaper        bool
	IsActive       bool
	UserID         string
	CredentialsEnc []byte // AES-256-GCM encrypted JSON blob
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// AccountRepository defines CRUD operations for broker_accounts.
type AccountRepository interface {
	CreateBrokerAccount(ctx context.Context, rec *BrokerAccountRecord) error
	ListBrokerAccounts(ctx context.Context, userID string) ([]*BrokerAccountRecord, error)
	GetBrokerAccount(ctx context.Context, id string) (*BrokerAccountRecord, error)
	DeactivateBrokerAccount(ctx context.Context, id string) error
	ListActiveBrokerAccounts(ctx context.Context) ([]*BrokerAccountRecord, error)
}

type pgAccountRepo struct {
	pool *pgxpool.Pool
}

// NewAccountRepo creates a new AccountRepository backed by the given pool.
func NewAccountRepo(pool *pgxpool.Pool) AccountRepository {
	return &pgAccountRepo{pool: pool}
}

func (r *pgAccountRepo) CreateBrokerAccount(ctx context.Context, rec *BrokerAccountRecord) error {
	if rec.ID == "" {
		rec.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	rec.CreatedAt = now
	rec.UpdatedAt = now
	_, err := r.pool.Exec(ctx, `
		INSERT INTO trading.broker_accounts
			(id, display_name, broker_type, is_paper, is_active, user_id, credentials_enc, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`,
		rec.ID, rec.DisplayName, rec.BrokerType, rec.IsPaper, rec.IsActive,
		rec.UserID, rec.CredentialsEnc, rec.CreatedAt, rec.UpdatedAt,
	)
	return err
}

func (r *pgAccountRepo) ListBrokerAccounts(ctx context.Context, userID string) ([]*BrokerAccountRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, display_name, broker_type, is_paper, is_active, user_id,
		       credentials_enc, created_at, updated_at
		FROM trading.broker_accounts
		WHERE user_id = $1
		ORDER BY created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBrokerAccounts(rows)
}

func (r *pgAccountRepo) GetBrokerAccount(ctx context.Context, id string) (*BrokerAccountRecord, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, display_name, broker_type, is_paper, is_active, user_id,
		       credentials_enc, created_at, updated_at
		FROM trading.broker_accounts
		WHERE id = $1
	`, id)
	rec, err := scanBrokerAccount(row)
	if err != nil {
		return nil, fmt.Errorf("GetBrokerAccount %s: %w", id, err)
	}
	return rec, nil
}

func (r *pgAccountRepo) DeactivateBrokerAccount(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE trading.broker_accounts
		SET is_active = FALSE, updated_at = NOW()
		WHERE id = $1
	`, id)
	return err
}

func (r *pgAccountRepo) ListActiveBrokerAccounts(ctx context.Context) ([]*BrokerAccountRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, display_name, broker_type, is_paper, is_active, user_id,
		       credentials_enc, created_at, updated_at
		FROM trading.broker_accounts
		WHERE is_active = TRUE
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBrokerAccounts(rows)
}

// ── scan helpers ──────────────────────────────────────────────────────────────

type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanBrokerAccount(row rowScanner) (*BrokerAccountRecord, error) {
	var rec BrokerAccountRecord
	err := row.Scan(
		&rec.ID, &rec.DisplayName, &rec.BrokerType,
		&rec.IsPaper, &rec.IsActive, &rec.UserID,
		&rec.CredentialsEnc, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func scanBrokerAccounts(rows interface {
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
}) ([]*BrokerAccountRecord, error) {
	var recs []*BrokerAccountRecord
	for rows.Next() {
		rec, err := scanBrokerAccount(rows)
		if err != nil {
			return nil, err
		}
		recs = append(recs, rec)
	}
	return recs, rows.Err()
}

// ── encryption helpers ────────────────────────────────────────────────────────

// EncryptCredentials encrypts credentialsJSON using AES-256-GCM.
// The returned ciphertext has a 12-byte random nonce prepended.
func EncryptCredentials(encKeyHex string, credentialsJSON []byte) ([]byte, error) {
	key, err := hex.DecodeString(encKeyHex)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("encKeyHex must be a 64-char hex string (32 bytes): %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes.NewCipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher.NewGCM: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize()) // 12 bytes
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("rand nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, credentialsJSON, nil)
	return ciphertext, nil
}

// DecryptCredentials decrypts a ciphertext produced by EncryptCredentials.
func DecryptCredentials(encKeyHex string, ciphertext []byte) ([]byte, error) {
	key, err := hex.DecodeString(encKeyHex)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("encKeyHex must be a 64-char hex string (32 bytes): %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes.NewCipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher.NewGCM: %w", err)
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("gcm.Open: %w", err)
	}
	return plaintext, nil
}
