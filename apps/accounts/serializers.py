from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from .models import CustomUser


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = [
            'id', 'email', 'first_name', 'last_name',
            'credits', 'plan', 'total_generations', 'created_at',
        ]
        read_only_fields = ['id', 'credits', 'plan', 'total_generations', 'created_at']


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True, label='Confirmar senha')

    class Meta:
        model = CustomUser
        fields = ['first_name', 'email', 'password', 'password2']

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({'password2': 'As senhas não coincidem.'})
        return attrs

    def validate_email(self, value):
        value = value.lower()
        if CustomUser.objects.filter(email=value).exists():
            raise serializers.ValidationError('Este e-mail já está cadastrado.')
        return value

    def create(self, validated_data):
        validated_data.pop('password2')
        password = validated_data.pop('password')
        email = validated_data['email'].lower()
        user = CustomUser(username=email, email=email, **{
            k: v for k, v in validated_data.items() if k != 'email'
        })
        user.set_password(password)
        user.save()
        return user
